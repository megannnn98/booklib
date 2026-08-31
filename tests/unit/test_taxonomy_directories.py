"""Папочные назначения в личной taxonomy.json."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from booklib.config.settings import get_settings
from booklib.taxonomy import _directory_section, apply


def test_directory_section_uses_most_specific_prefix() -> None:
    directories = {
        "authors": "Художественная литература",
        "authors/lem": "Научная фантастика",
    }

    assert _directory_section("authors/lem/Solaris.epub", directories) == "Научная фантастика"
    assert (
        _directory_section("authors/other/Novel.epub", directories) == "Художественная литература"
    )


def test_directory_section_does_not_match_a_similar_prefix() -> None:
    assert (
        _directory_section("authors-lem/Solaris.epub", {"authors": "Художественная литература"})
        is None
    )


def test_exact_book_assignment_beats_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "taxonomy.json").write_text(
        json.dumps(
            {
                "directories": {"authors": "Научная фантастика"},
                "books": {"authors/lem/Solaris.epub": {"section": "Языки"}},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BOOKLIB_CONFIG_DIR", str(config_dir))
    get_settings.cache_clear()
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE books(key TEXT, kind TEXT, title TEXT, author TEXT, missing INTEGER, "
        "section TEXT, section_source TEXT)"
    )
    conn.execute(
        "INSERT INTO books VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("authors/lem/Solaris.epub", "book", "Solaris", None, 0, "Новое", "default"),
    )

    apply(conn)

    assert conn.execute("SELECT section FROM books").fetchone()[0] == "Языки"
