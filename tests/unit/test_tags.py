"""Ядро тегов: ручные назначения и словарь."""

from __future__ import annotations

from pathlib import Path

import pytest

from booklib.db import connect_at
from booklib.tags import (
    TagConflict,
    TagInUse,
    TagInvalid,
    TagNotFound,
    add_alias,
    create_tag,
    delete_tag,
    list_tags,
    merge_tags,
    normalize,
    resolve,
    set_book_tags,
    tags_for,
)


def test_normalize_trims_and_rejects_empty() -> None:
    assert normalize("  Гегель  ") == "Гегель"
    with pytest.raises(TagInvalid):
        normalize("   ")


def test_create_tag_rejects_unknown_kind(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    with pytest.raises(TagInvalid):
        create_tag(conn, "Гегель", "unknown", None)


def test_tags_are_case_insensitively_unique(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    create_tag(conn, "Гегель", "topic", None)
    with pytest.raises(TagConflict):
        create_tag(conn, "гегель", "topic", None)


def test_name_and_alias_conflict_cross_tables(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    left = create_tag(conn, "Гегель", "topic", None)
    right = create_tag(conn, "Диалектика", "topic", None)
    add_alias(conn, right["id"], "идеализм")

    with pytest.raises(TagConflict):
        add_alias(conn, left["id"], "диалектика")


def test_resolve_accepts_alias(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", None)
    add_alias(conn, tag["id"], "немецкий идеализм")

    assert resolve(conn, ["немецкий идеализм"]) == [tag["id"]]


def test_merge_moves_book_links_and_aliases(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    source = create_tag(conn, "Гегель", "topic", None)
    target = create_tag(conn, "Философия", "topic", None)
    add_alias(conn, source["id"], "немецкий идеализм")
    conn.execute(
        "INSERT INTO books(key, dir, basename, title, author, year, section, section_source, "
        "kind, formats_json, files_json, primary_file, size, mtime, has_cover, cover_error, "
        "added_at, seen_at, missing) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "book-1",
            ".",
            "b.pdf",
            "Book",
            None,
            None,
            None,
            None,
            "book",
            "[]",
            "[]",
            "b.pdf",
            1,
            1.0,
            0,
            None,
            1.0,
            1.0,
            0,
        ),
    )
    conn.commit()
    set_book_tags(conn, "book-1", ["Гегель", "Философия"])
    conn.commit()

    summary = merge_tags(conn, source["id"], target["id"])

    assert summary["moved"] == 1
    assert summary["aliases_moved"] == 1
    assert summary["skipped"] == 0
    assert resolve(conn, ["немецкий идеализм"]) == [target["id"]]
    tags = tags_for(conn, ["book-1"])
    assert {item["name"] for item in tags["book-1"]} == {"Философия"}


def test_delete_used_tag_is_blocked(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", None)
    conn.execute(
        "INSERT INTO books(key, dir, basename, title, author, year, section, section_source, "
        "kind, formats_json, files_json, primary_file, size, mtime, has_cover, cover_error, "
        "added_at, seen_at, missing) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "book-1",
            ".",
            "b.pdf",
            "Book",
            None,
            None,
            None,
            None,
            "book",
            "[]",
            "[]",
            "b.pdf",
            1,
            1.0,
            0,
            None,
            1.0,
            1.0,
            0,
        ),
    )
    conn.commit()
    set_book_tags(conn, "book-1", ["Гегель"])
    conn.commit()

    with pytest.raises(TagInUse):
        delete_tag(conn, tag["id"])


def test_list_tags_reports_counts_and_aliases(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    tag = create_tag(conn, "Гегель", "topic", "desc")
    add_alias(conn, tag["id"], "немецкий идеализм")
    conn.execute(
        "INSERT INTO books(key, dir, basename, title, author, year, section, section_source, "
        "kind, formats_json, files_json, primary_file, size, mtime, has_cover, cover_error, "
        "added_at, seen_at, missing) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "book-1",
            ".",
            "b.pdf",
            "Book",
            None,
            None,
            None,
            None,
            "book",
            "[]",
            "[]",
            "b.pdf",
            1,
            1.0,
            0,
            None,
            1.0,
            1.0,
            0,
        ),
    )
    conn.commit()
    set_book_tags(conn, "book-1", ["Гегель"])
    conn.commit()

    rows = list_tags(conn)
    assert rows[0]["count"] == 1
    assert rows[0]["aliases"] == ["немецкий идеализм"]


def test_set_book_tags_unknown_name_rolls_back(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "tags.db")
    create_tag(conn, "Гегель", "topic", None)
    conn.execute(
        "INSERT INTO books(key, dir, basename, title, author, year, section, section_source, "
        "kind, formats_json, files_json, primary_file, size, mtime, has_cover, cover_error, "
        "added_at, seen_at, missing) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "book-1",
            ".",
            "b.pdf",
            "Book",
            None,
            None,
            None,
            None,
            "book",
            "[]",
            "[]",
            "b.pdf",
            1,
            1.0,
            0,
            None,
            1.0,
            1.0,
            0,
        ),
    )
    conn.commit()

    with pytest.raises(TagNotFound):
        set_book_tags(conn, "book-1", ["Гегель", "Неизвестный"])

    assert tags_for(conn, ["book-1"]) == {"book-1": []}
