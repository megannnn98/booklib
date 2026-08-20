"""Сортировка по названию: кириллица без учёта регистра.

COLLATE NOCASE, как и LOWER(), понимает только ASCII: 'абрикос' со строчной
буквы уезжал в хвост списка. pylower и коллация unicode_ci регистрируются в
connect() — поэтому работают на любом соединении (API через closing(connect()),
CLI, сканер), а не только на «своём» thin-wrapper'е из api-слоя (удалён).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from booklib.api.app import SORTS, app
from booklib.db import connect_at
from booklib.grouping import collect_groups
from booklib.scanner import sync
from tests.conftest import make_book

OWN_PAGE = {"X-Booklib": "1"}


def test_cyrillic_title_sort_ignores_case(library: Path, db: sqlite3.Connection) -> None:
    for name in ("Абрикос", "Банан", "Яблоко", "абрикос", "яблоко"):
        make_book(library, f"{name}.pdf")
    sync(db, collect_groups())
    db.commit()

    data = TestClient(app).get("/api/books", params={"sort": "title"}, headers=OWN_PAGE).json()

    titles = [book["title"] for book in data["books"]]
    assert titles == ["Абрикос", "абрикос", "Банан", "Яблоко", "яблоко"]


def test_collations_registered_on_plain_connect(tmp_path: Path) -> None:
    """SQL из SORTS корректен на соединении из connect() — не только на api-слое.

    Без регистрации в connect() запрос 'title COLLATE unicode_ci' падал бы
    'no such collation sequence', а 'pylower(...)' — 'no such function'.
    """
    conn = connect_at(tmp_path / "collations.db")
    try:
        conn.execute("CREATE TABLE t(title TEXT)")
        conn.execute('INSERT INTO t VALUES("абрикос")')
        conn.execute('INSERT INTO t VALUES("Яблоко")')
        conn.execute('INSERT INTO t VALUES("Банан")')

        # pylower зарегистрирован на соединении из connect()
        casefold = conn.execute("SELECT pylower(title) AS v FROM t").fetchall()
        assert {r["v"] for r in casefold} == {"абрикос", "яблоко", "банан"}

        # COLLATE unicode_ci работает на этом же соединении
        order = SORTS["title"]
        rows = conn.execute(f"SELECT title AS t FROM t ORDER BY {order}").fetchall()
        assert [r["t"] for r in rows] == ["абрикос", "Банан", "Яблоко"]
    finally:
        conn.close()
