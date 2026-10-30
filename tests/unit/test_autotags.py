"""Автотеги: правила tag_rules.json → связи book_tags с source = 'auto'."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from typer.testing import CliRunner

from booklib import autotags
from booklib.cli.app import app
from booklib.config.settings import PACKAGE_CONFIG_DIR, get_settings
from booklib.db import connect_at
from booklib.tags import add_alias, create_tag, set_book_tags, tags_for

RULES = {
    "rules": [
        {"tag": "Zephyr", "kind": "technology", "pattern": "zephyr"},
        {"tag": "embedded", "kind": "topic", "pattern": "embedded|прошивк"},
        {"tag": "анархизм", "kind": "topic", "pattern": "анарх"},
    ]
}


def _write_rules(tmp_path: Path, data: dict | None = None) -> Path:
    """Положить правила в config_dir изолированных настроек (см. conftest)."""
    path = tmp_path / "config" / "tag_rules.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data if data is not None else RULES), encoding="utf-8")
    return path


def _insert_book(
    conn: sqlite3.Connection,
    key: str,
    title: str = "Book",
    author: str | None = None,
    missing: int = 0,
) -> None:
    conn.execute(
        "INSERT INTO books(key, dir, basename, title, author, year, section, section_source, "
        "kind, formats_json, files_json, primary_file, size, mtime, has_cover, cover_error, "
        "added_at, seen_at, missing) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            key,
            ".",
            "b.pdf",
            title,
            author,
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
            missing,
        ),
    )


def _apply(conn: sqlite3.Connection, tmp_path: Path, data: dict | None = None) -> dict[str, int]:
    _write_rules(tmp_path, data)
    return autotags.apply(conn)


def _names(conn: sqlite3.Connection, key: str) -> list[str]:
    return sorted(tag["name"] for tag in tags_for(conn, [key])[key])


def _sources(conn: sqlite3.Connection, key: str) -> dict[str, str]:
    rows = conn.execute(
        "SELECT t.name, bt.source FROM book_tags bt JOIN tags t ON t.id = bt.tag_id "
        "WHERE bt.book_key = ?",
        (key,),
    ).fetchall()
    return {row["name"]: row["source"] for row in rows}


def test_packaged_rules_load_and_compile() -> None:
    """Файл лежит внутри пакета — только так он попадёт в wheel."""
    path = PACKAGE_CONFIG_DIR / "tag_rules.json"
    assert path.exists(), f"пакетный файл правил тегов не найден: {path}"
    rules = autotags.load_rules(path)
    assert len(rules) > 10
    assert len({rule.tag for rule in rules}) == len(rules), "дубли имён тегов в правилах"


def test_package_default_when_config_dir_missing(tmp_path: Path, monkeypatch) -> None:
    """Установка колесом: config_dir не существует, правила — пакетный дефолт.

    Мутация: убрать фолбэк на PACKAGE_CONFIG_DIR в resolve_config_file — тест
    падает, и автотеги молча не расставляются ни на одной книге.
    """
    monkeypatch.setenv("BOOKLIB_CONFIG_DIR", str(tmp_path / "no-such-config"))
    get_settings.cache_clear()
    assert autotags.load_rules(), "пакетный дефолт не найден — автотегов не будет"


def test_match_text_ignores_folder_but_takes_title_and_author() -> None:
    text = autotags.match_text("anarchy/foo_bar", "Zephyr RTOS", "Иванов")
    assert "foo bar" in text
    assert "Zephyr RTOS" in text
    assert "Иванов" in text
    assert "anarchy" not in text


def test_missing_rules_file_is_not_an_error(tmp_path: Path) -> None:
    assert autotags.load_rules(tmp_path / "нет.json") == []


def test_apply_creates_tags_and_links(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "auto.db")
    _insert_book(conn, "dir/zephyr_getting_started")
    conn.commit()

    stats = _apply(conn, tmp_path)

    assert stats["tags_created"] == 3
    assert stats["tagged"] == 1
    assert _names(conn, "dir/zephyr_getting_started") == ["Zephyr"]
    assert _sources(conn, "dir/zephyr_getting_started") == {"Zephyr": "auto"}


def test_all_matching_rules_fire(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "auto.db")
    _insert_book(conn, "dir/zephyr_embedded_book")
    conn.commit()

    _apply(conn, tmp_path)

    assert _names(conn, "dir/zephyr_embedded_book") == ["Zephyr", "embedded"]


def test_manual_link_survives_and_stays_manual(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "auto.db")
    _insert_book(conn, "dir/zephyr_book")
    conn.commit()
    create_tag(conn, "Zephyr", "technology", None)
    create_tag(conn, "мой тег", "custom", None)
    set_book_tags(conn, "dir/zephyr_book", ["Zephyr", "мой тег"])

    _apply(conn, tmp_path)

    assert _sources(conn, "dir/zephyr_book") == {"Zephyr": "manual", "мой тег": "manual"}


def test_apply_is_idempotent(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "auto.db")
    _insert_book(conn, "dir/zephyr_embedded_book")
    conn.commit()

    first = _apply(conn, tmp_path)
    second = _apply(conn, tmp_path)

    assert first["links"] == second["links"] == 2
    assert second["tags_created"] == 0
    assert _names(conn, "dir/zephyr_embedded_book") == ["Zephyr", "embedded"]


def test_removed_rule_drops_its_links(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "auto.db")
    _insert_book(conn, "dir/zephyr_embedded_book")
    conn.commit()

    _apply(conn, tmp_path)
    _apply(conn, tmp_path, {"rules": [RULES["rules"][0]]})

    assert _names(conn, "dir/zephyr_embedded_book") == ["Zephyr"]


def test_rule_name_resolves_through_existing_alias(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "auto.db")
    _insert_book(conn, "dir/zephyr_book")
    conn.commit()
    tag = create_tag(conn, "Зефир", "technology", None)
    add_alias(conn, tag["id"], "Zephyr")

    stats = _apply(conn, tmp_path)

    assert stats["tags_created"] == 2, "тег правила уже существует под алиасом"
    assert _names(conn, "dir/zephyr_book") == ["Зефир"]


def test_missing_books_are_tagged_too(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "auto.db")
    _insert_book(conn, "dir/zephyr_book", missing=1)
    conn.commit()

    _apply(conn, tmp_path)

    assert _names(conn, "dir/zephyr_book") == ["Zephyr"]


def test_manual_title_override_feeds_rules(tmp_path: Path) -> None:
    """Правка названия в UI — ровно тот случай, когда имя файла нечитаемо.

    Мутация: матчить по `books.title` вместо COALESCE с overrides — тест падает.
    """
    conn = connect_at(tmp_path / "auto.db")
    _insert_book(conn, "dir/01129628", title="01129628")
    conn.execute(
        "INSERT INTO overrides(key, title, author, section, updated_at) VALUES(?,?,?,?,?)",
        ("dir/01129628", "Zephyr RTOS", None, None, 1.0),
    )
    conn.commit()

    _apply(conn, tmp_path)

    assert _names(conn, "dir/01129628") == ["Zephyr"]


def test_dry_run_reports_without_writing(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "auto.db")
    _insert_book(conn, "dir/zephyr_book")
    _insert_book(conn, "dir/plain_book")
    conn.commit()
    _write_rules(tmp_path)

    preview = autotags.preview(conn)
    coverage = autotags.coverage(conn)

    assert preview["tagged"] == 1
    assert coverage["tagged"] == 0, "preview записал связи"
    assert conn.execute("SELECT COUNT(*) AS n FROM tags").fetchone()["n"] == 0


def test_coverage_counts_live_books_only(tmp_path: Path) -> None:
    conn = connect_at(tmp_path / "auto.db")
    _insert_book(conn, "dir/zephyr_book")
    _insert_book(conn, "dir/plain_book")
    _insert_book(conn, "dir/zephyr_gone", missing=1)
    conn.commit()

    _apply(conn, tmp_path)
    coverage = autotags.coverage(conn)

    assert coverage["books"] == 2
    assert coverage["tagged"] == 1
    assert coverage["tags"] == [("Zephyr", 1)]


def test_cli_tags_dry_run_does_not_write(tmp_path: Path, db: sqlite3.Connection) -> None:
    """`booklib tags --dry-run` печатает покрытие и не оставляет связей.

    Мутация: в tags_cmd звать apply вместо preview при --dry-run — тест падает.
    """
    _insert_book(db, "dir/zephyr_book")
    db.commit()
    _write_rules(tmp_path)

    result = CliRunner().invoke(app, ["tags", "--dry-run"])

    assert result.exit_code == 0, result.output
    assert "с тегами: 1/1" in result.output
    assert db.execute("SELECT COUNT(*) AS n FROM book_tags").fetchone()["n"] == 0


def test_packaged_c_rule_does_not_swallow_cpp() -> None:
    """`\\b` стоит и между 'C' и '+': без хвоста (?![+\\w]) «Beginning C++»
    становился книгой по Си. Мутация: убрать хвост из правила — тест падает."""
    rules = {rule.tag: rule for rule in autotags.load_rules(PACKAGE_CONFIG_DIR / "tag_rules.json")}
    c_rule = rules["C"].pattern

    assert c_rule.search("Head First C")
    assert c_rule.search("Программирование на языке Си")
    assert not c_rule.search("Beginning C++20 From Novice to Professional")
    assert not c_rule.search("Programming in C++ for engineers")
