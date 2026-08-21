"""Общие пользовательские данные: preferences, import и LAN sync."""

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


def _client(host: str = "127.0.0.1") -> TestClient:
    port = 51200 if host == "127.0.0.1" else 50000
    return TestClient(app, client=(host, port))


def _prepare_library(library: Path, db: sqlite3.Connection) -> str:
    make_book(library, "philosophy/Эвола - Даосизм - 2020.pdf")
    sync(db, collect_groups())
    apply_sections(db)
    db.commit()
    return "philosophy/Эвола - Даосизм - 2020"


def test_preferences_round_trip_and_restart(library: Path, db: sqlite3.Connection) -> None:
    _prepare_library(library, db)
    client = _client()

    assert client.get("/api/preferences", headers=OWN_PAGE).json() == {
        "sort": "title",
        "section": "*",
        "tags": [],
    }

    saved = client.put(
        "/api/preferences",
        json={"sort": "added", "section": "philosophy", "tags": ["Даосизм"]},
        headers=OWN_PAGE,
    )
    assert saved.status_code == 200
    assert saved.json() == {"sort": "added", "section": "philosophy", "tags": ["Даосизм"]}

    client.close()
    restarted = _client()
    assert restarted.get("/api/preferences", headers=OWN_PAGE).json() == {
        "sort": "added",
        "section": "philosophy",
        "tags": ["Даосизм"],
    }


def test_legacy_import_merges_without_duplicates(library: Path, db: sqlite3.Connection) -> None:
    key = _prepare_library(library, db)
    client = _client()

    client.post(
        "/api/tags",
        json={"name": "Гегель", "kind": "topic", "description": "server"},
        headers=OWN_PAGE,
    )
    client.put(f"/api/book/{key}/tags", json={"tags": ["Гегель"]}, headers=OWN_PAGE)

    payload = {
        "preferences": {"sort": "added", "section": "philosophy", "tags": ["Гегель"]},
        "tags": [
            {
                "name": "Гегель",
                "kind": "topic",
                "description": "legacy",
                "aliases": ["немецкий идеализм"],
            },
            {"name": "Философия", "kind": "topic", "description": "legacy"},
        ],
        "books": [{"key": key, "tags": ["Гегель", "Философия"]}],
    }

    first = client.post("/api/import", json=payload, headers=OWN_PAGE)
    second = client.post("/api/import", json=payload, headers=OWN_PAGE)

    assert first.status_code == 200
    assert second.status_code == 200
    assert client.get("/api/preferences", headers=OWN_PAGE).json() == {
        "sort": "added",
        "section": "philosophy",
        "tags": ["Гегель"],
    }

    tags_payload = client.get("/api/tags").json()
    assert {tag["name"] for tag in tags_payload} == {"Гегель", "Философия"}
    hegel = next(tag for tag in tags_payload if tag["name"] == "Гегель")
    assert hegel["description"] == "server"
    assert hegel["aliases"] == ["немецкий идеализм"]

    books = client.get("/api/books").json()["books"]
    book = next(item for item in books if item["key"] == key)
    assert {tag["name"] for tag in book["tags"]} == {"Гегель", "Философия"}


def test_remote_mutation_round_trip_is_shared(library: Path, db: sqlite3.Connection) -> None:
    key = _prepare_library(library, db)
    local = _client("127.0.0.1")
    remote = _client("192.168.0.50")

    created = remote.post(
        "/api/tags",
        json={"name": "Даосизм", "kind": "topic"},
        headers=OWN_PAGE,
    )
    assert created.status_code == 200

    attached = remote.put(
        f"/api/book/{key}/tags",
        json={"tags": ["Даосизм"]},
        headers=OWN_PAGE,
    )
    assert attached.status_code == 200

    assert {tag["name"] for tag in local.get("/api/tags").json()} == {"Даосизм"}
    book = next(item for item in local.get("/api/books").json()["books"] if item["key"] == key)
    assert {tag["name"] for tag in book["tags"]} == {"Даосизм"}
