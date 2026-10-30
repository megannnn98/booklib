"""API: фильтр каталога по формату файла и сводка форматов для панели фильтров."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from booklib.api.app import app
from booklib.grouping import collect_groups
from booklib.scanner import sync
from tests.conftest import make_book


@pytest.fixture
def client(library: Path, db: sqlite3.Connection) -> TestClient:
    # Одна книга в двух форматах = одна карточка с formats ["pdf", "epub"].
    make_book(library, "prog/Керниган - Язык C.pdf")
    make_book(library, "prog/Керниган - Язык C.epub", b"PK\x03\x04")
    make_book(library, "math/Фихтенгольц - Курс анализа.djvu", b"AT&TFORM")
    make_book(library, "sf/Лем - Солярис.fb2", b"<FictionBook/>")
    sync(db, collect_groups())
    db.commit()
    return TestClient(app, client=("192.168.0.50", 50000))


def _titles(client: TestClient, **params: object) -> set[str]:
    data = client.get("/api/books", params=params).json()
    assert data["total"] == len(data["books"])
    return {book["title"] for book in data["books"]}


def test_format_filter_matches_any_file_of_the_card(client: TestClient) -> None:
    """Карточка проходит фильтр, если формат есть среди её файлов, не только у primary."""
    assert _titles(client, format="epub") == {"Язык C"}
    assert _titles(client, format="pdf") == {"Язык C"}


def test_repeated_format_is_or(client: TestClient) -> None:
    assert _titles(client, format=["djvu", "fb2"]) == {"Курс анализа", "Солярис"}


def test_format_filter_is_case_insensitive(client: TestClient) -> None:
    assert _titles(client, format="DJVU") == {"Курс анализа"}


def test_format_filter_combines_with_search_and_keeps_total(client: TestClient) -> None:
    """total считается с тем же WHERE, иначе пагинация «Показать ещё» врёт."""
    data = client.get("/api/books", params={"format": ["pdf", "fb2"], "q": "лем"}).json()
    assert data["total"] == 1
    assert [book["title"] for book in data["books"]] == ["Солярис"]

    page = client.get("/api/books", params={"format": ["pdf", "fb2"], "limit": 1}).json()
    assert page["total"] == 2
    assert len(page["books"]) == 1


def test_formats_summary_is_public_and_counts_cards(client: TestClient) -> None:
    """Сводка для чипов фильтра: read-only, гостю доступна, считает карточки."""
    data = client.get("/api/formats").json()
    assert data == [
        {"name": "djvu", "count": 1},
        {"name": "epub", "count": 1},
        {"name": "fb2", "count": 1},
        {"name": "pdf", "count": 1},
    ]
