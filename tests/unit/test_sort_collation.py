"""Сортировка по названию: кириллица без учёта регистра.

COLLATE NOCASE, как и LOWER(), понимает только ASCII: 'абрикос' со строчной
буквы уезжал в хвост списка. Сортируем через зарегистрированную на соединении
коллацию unicode_ci (casefold). Тест гоняется через /api/books, чтобы
проверялась связка SORTS + db().
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from booklib.api.app import app
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
