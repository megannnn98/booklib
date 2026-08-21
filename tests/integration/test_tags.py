"""Теги через HTTP: публичная выдача, правка и фильтрация каталога."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from booklib.api.app import app
from booklib.grouping import collect_groups
from booklib.scanner import sync
from booklib.taxonomy import apply as apply_sections
from tests.conftest import make_book

OWN_PAGE = {"X-Booklib": "1"}


def _client(library: Path, db: sqlite3.Connection) -> TestClient:
    make_book(library, "philosophy/Эвола - Даосизм - 2020.pdf")
    make_book(library, "philosophy/Гегель - Наука логики - 1812.pdf")
    sync(db, collect_groups())
    apply_sections(db)
    db.commit()
    return TestClient(app, client=("127.0.0.1", 51200))


def test_public_tags_and_book_tags(library: Path, db: sqlite3.Connection) -> None:
    client = _client(library, db)
    assert client.get("/api/tags").json() == []

    created = client.post(
        "/api/tags",
        json={"name": "Гегель", "kind": "topic", "description": "немецкая философия"},
        headers=OWN_PAGE,
    ).json()
    assert created["name"] == "Гегель"

    alias = client.post(
        f"/api/tags/{created['id']}/aliases",
        json={"alias": "немецкий идеализм"},
        headers=OWN_PAGE,
    ).json()
    assert alias["aliases"] == ["немецкий идеализм"]

    key = "philosophy/Гегель - Наука логики - 1812"
    edited = client.put(
        f"/api/book/{key}/tags",
        json={"tags": ["Гегель"]},
        headers=OWN_PAGE,
    )
    assert edited.status_code == 200

    books = client.get("/api/books").json()["books"]
    book = next(item for item in books if item["key"] == key)
    assert [tag["name"] for tag in book["tags"]] == ["Гегель"]

    filtered = client.get("/api/books", params=[("tag", "немецкий идеализм")]).json()
    assert filtered["total"] == 1
    assert filtered["books"][0]["key"] == key

    search = client.get("/api/books", params={"q": "идеализм"}).json()
    assert search["total"] == 1


def test_tag_validation_errors_are_422(library: Path, db: sqlite3.Connection) -> None:
    client = _client(library, db)
    assert client.post("/api/tags", headers=OWN_PAGE).status_code == 422
    assert (
        client.put("/api/book/philosophy/Эвола - Даосизм - 2020/tags", headers=OWN_PAGE).status_code
        == 422
    )
    assert client.post("/api/tags/merge", headers=OWN_PAGE).status_code == 422


def test_tag_filter_rejects_unknown_name(library: Path, db: sqlite3.Connection) -> None:
    client = _client(library, db)
    response = client.get("/api/books", params=[("tag", "неизвестный")])
    assert response.status_code == 400


def test_book_tags_route_supports_slashes_in_key(library: Path, db: sqlite3.Connection) -> None:
    client = _client(library, db)
    client.post("/api/tags", json={"name": "Даосизм"}, headers=OWN_PAGE)

    response = client.put(
        "/api/book/philosophy/Эвола - Даосизм - 2020/tags",
        json={"tags": ["Даосизм"]},
        headers=OWN_PAGE,
    )
    assert response.status_code == 200
    assert client.get("/api/books").json()["books"][0]["tags"][0]["name"] == "Даосизм"


def test_remote_cannot_mutate_tags(library: Path, db: sqlite3.Connection) -> None:
    remote = TestClient(app, client=("192.168.0.50", 50000))
    assert remote.post("/api/tags", json={"name": "x"}, headers=OWN_PAGE).status_code == 403
    assert (
        remote.put(
            "/api/book/philosophy/Эвола - Даосизм - 2020/tags",
            json={"tags": ["x"]},
            headers=OWN_PAGE,
        ).status_code
        == 403
    )
