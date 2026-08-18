"""Смена корня: слот состояния на корень, миграция legacy, guard на свежем корне."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from booklib.api.app import app
from booklib.config.settings import get_settings, write_runtime_config
from booklib.db import connect
from booklib.grouping import collect_groups
from booklib.scanner import sync
from tests.conftest import make_book

OWN_PAGE = {"X-Booklib": "1"}


def test_switch_root_gets_own_slot(library: Path) -> None:
    """Другой корень — другой слот: одинаковый относительный путь в двух библиотеках
    — это одна строка по PRIMARY KEY, и один файл обложки (sha1 ключа без корня)."""
    make_book(library, "a.pdf")
    conn = connect()
    try:
        sync(conn, collect_groups())
        assert conn.execute("SELECT COUNT(*) AS n FROM books").fetchone()["n"] == 1
    finally:
        conn.close()
    first_slot = get_settings().slot_dir

    root2 = library.parent / "library2"
    root2.mkdir()
    make_book(root2, "b.pdf")
    write_runtime_config(root=str(root2))

    conn = connect()
    try:
        stats = sync(conn, collect_groups())
        assert stats["added"] == 1
        assert conn.execute("SELECT COUNT(*) AS n FROM books").fetchone()["n"] == 1
    finally:
        conn.close()

    assert get_settings().slot_dir != first_slot
    # старый слот не тронут: можно вернуться на прежний корень
    n = (
        sqlite3.connect(first_slot / "library.db")
        .execute("SELECT COUNT(*) FROM books")
        .fetchone()[0]
    )
    assert n == 1


def test_guard_does_not_fire_on_fresh_root(library: Path) -> None:
    """Свежий корень стартует с пустой СУБД (known = 0) — guard молчит, хотя книг нет."""
    make_book(library, "a.pdf")
    conn = connect()
    try:
        sync(conn, collect_groups())
    finally:
        conn.close()

    empty = library.parent / "empty"
    empty.mkdir()
    write_runtime_config(root=str(empty))
    conn = connect()
    try:
        stats = sync(conn, collect_groups())
        assert stats["missing"] == 0
    finally:
        conn.close()

    # возврат на населённый корень — guard работает как раньше
    write_runtime_config(root=str(library))
    conn = connect()
    try:
        stats = sync(conn, collect_groups())
        assert (stats["added"], stats["unchanged"]) == (0, 1)
    finally:
        conn.close()


def test_legacy_state_migrates_into_slot(library: Path) -> None:
    """Старая версия держала СУБД и обложки прямо в cache_dir — переносим в слот.

    Без этого 353 карточки и правки overrides «исчезли» бы после обновления.
    """
    make_book(library, "a.pdf")
    cache = get_settings().cache_dir
    legacy = cache / "library.db"
    conn = connect(legacy)  # так работала старая версия
    try:
        sync(conn, collect_groups())
    finally:
        conn.close()
    covers_dir = cache / "covers"
    covers_dir.mkdir()
    (covers_dir / "x.jpg").write_bytes(b"jpeg")

    conn = connect()  # первый вызов нового кода мигрирует состояние
    try:
        n = conn.execute("SELECT COUNT(*) AS n FROM books").fetchone()["n"]
    finally:
        conn.close()

    assert n == 1
    assert not legacy.exists()
    assert get_settings().db_path.exists()
    assert (get_settings().slot_dir / "covers" / "x.jpg").exists()
    assert (get_settings().slot_dir / "root.txt").read_text() == str(library)


def test_edits_survive_switch_away_and_back(library: Path) -> None:
    """overrides — единственные невосстановимые данные; смена корня их не теряет."""
    client = TestClient(app)
    make_book(library, "a.pdf")
    assert client.post("/api/rescan", headers=OWN_PAGE).status_code == 200
    saved = client.post("/api/book", json={"key": "a", "title": "Правка"}, headers=OWN_PAGE)
    assert saved.json()["action"] == "saved"

    root2 = library.parent / "library2"
    root2.mkdir()
    make_book(root2, "b.pdf")
    assert (
        client.post("/api/settings", json={"root": str(root2)}, headers=OWN_PAGE).status_code == 200
    )
    assert (
        client.post("/api/settings", json={"root": str(library)}, headers=OWN_PAGE).status_code
        == 200
    )

    books = client.get("/api/books", headers=OWN_PAGE).json()
    card = next(b for b in books["books"] if b["key"] == "a")
    assert (card["title"], card["edited"]) == ("Правка", True)


def test_settings_api_preview_and_apply(library: Path) -> None:
    client = TestClient(app)
    make_book(library, "a.pdf")
    make_book(library, "b.pdf")

    preview = client.get("/api/settings/preview", params={"root": str(library)}, headers=OWN_PAGE)
    assert preview.status_code == 200
    assert preview.json()["books"] == 2

    assert (
        client.get("/api/settings/preview", params={"root": "/"}, headers=OWN_PAGE).status_code
        == 400
    )

    root2 = library.parent / "library2"
    root2.mkdir()
    make_book(root2, "c.pdf")
    applied = client.post("/api/settings", json={"root": str(root2)}, headers=OWN_PAGE)
    assert applied.status_code == 200
    assert applied.json()["added"] == 1

    books = client.get("/api/books", headers=OWN_PAGE).json()
    assert books["total"] == 1
    assert books["books"][0]["key"] == "c"
    assert client.get("/api/settings", headers=OWN_PAGE).json()["root_source"] == "config"

    # невалидный корень не трогает конфиг
    assert client.post("/api/settings", json={"root": "/nope"}, headers=OWN_PAGE).status_code == 400
    assert client.get("/api/settings", headers=OWN_PAGE).json()["root"] == str(root2)
