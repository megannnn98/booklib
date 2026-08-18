"""API: guard'ы на открытие папки, приоритет overrides, выдача каталога."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from booklib.api.app import app
from booklib.grouping import collect_groups
from booklib.opener import BookNotFound, OutsideLibrary, resolve_target
from booklib.scanner import sync
from booklib.taxonomy import apply as apply_sections
from tests.conftest import make_book

OWN_PAGE = {"X-Booklib": "1"}


@pytest.fixture
def client(library: Path, db: sqlite3.Connection) -> TestClient:
    make_book(library, "chemistry/Шульпин - Химия - 1984.pdf")
    make_book(library, "philosophy/Эвола - Даосизм - 2020.pdf")
    sync(db, collect_groups())
    apply_sections(db)
    db.commit()
    return TestClient(app)


def test_status_and_books(client: TestClient) -> None:
    status = client.get("/api/status").json()
    assert status["mounted"] is True
    assert status["total"] == 2

    books = client.get("/api/books").json()
    assert books["total"] == 2
    assert {b["title"] for b in books["books"]} == {"Химия", "Даосизм"}


def test_search_is_case_insensitive_for_cyrillic(client: TestClient) -> None:
    """LOWER() в SQLite умеет только ASCII — поиск идёт через свою pylower()."""
    lower = client.get("/api/books", params={"q": "даосизм"}).json()
    upper = client.get("/api/books", params={"q": "ДАОСИЗМ"}).json()

    assert lower["total"] == upper["total"] == 1


def test_open_requires_own_page_header(client: TestClient) -> None:
    """Локалхост не защищает от чужой вкладки: /api/open запускает процессы."""
    response = client.post("/api/open", json={"key": "chemistry/Шульпин - Химия - 1984"})

    assert response.status_code == 403


def test_rescan_and_edit_require_own_page_header(client: TestClient) -> None:
    assert client.post("/api/rescan").status_code == 403
    assert client.post("/api/book", json={"key": "x", "title": "y"}).status_code == 403


def test_settings_require_own_page_header(client: TestClient) -> None:
    """/api/settings тоже под Depends(require_own_page): смена корня меняет
    конфиг и запускает скан."""
    assert client.get("/api/settings").status_code == 403
    assert client.get("/api/settings/preview", params={"root": "/tmp"}).status_code == 403
    assert client.post("/api/settings", json={"root": "/tmp"}).status_code == 403


def test_settings_report(client: TestClient, library: Path) -> None:
    settings = client.get("/api/settings", headers=OWN_PAGE).json()

    assert settings["root"] == str(library)  # BOOKLIB_ROOT из conftest
    assert settings["root_source"] == "env"
    assert settings["mounted"] is True
    assert settings["db"].endswith("library.db")
    assert "roots" in settings["db"]
    assert settings["read_only"]["host"] == "127.0.0.1"
    assert settings["read_only"]["tools"]["pdftocairo"] is True


def test_open_unknown_key_is_404(client: TestClient) -> None:
    response = client.post("/api/open", json={"key": "../../etc/passwd"}, headers=OWN_PAGE)

    assert response.status_code == 404


def test_override_wins_and_survives_rescan(client: TestClient, db: sqlite3.Connection) -> None:
    key = "philosophy/Эвола - Даосизм - 2020"

    saved = client.post(
        "/api/book",
        json={"key": key, "title": "Мой заголовок", "section": "Свой раздел"},
        headers=OWN_PAGE,
    )
    assert saved.json()["action"] == "saved"

    client.post("/api/rescan", headers=OWN_PAGE)

    book = next(b for b in client.get("/api/books").json()["books"] if b["key"] == key)
    assert (book["title"], book["section"], book["edited"]) == (
        "Мой заголовок",
        "Свой раздел",
        True,
    )

    # правка живёт отдельно от таксономии и не портит её
    row = db.execute("SELECT title, section FROM books WHERE key = ?", (key,)).fetchone()
    assert row["title"] == "Даосизм"

    client.post("/api/book", json={"key": key, "reset": True}, headers=OWN_PAGE)
    book = next(b for b in client.get("/api/books").json()["books"] if b["key"] == key)
    assert (book["title"], book["edited"]) == ("Даосизм", False)


def test_resolve_target_rejects_path_outside_library(db: sqlite3.Connection) -> None:
    """Guard от выхода за пределы библиотеки: без него nemo показал бы /etc/passwd."""
    now = time.time()
    db.execute(
        """INSERT INTO books(key, dir, basename, title, kind, formats_json, files_json,
                             primary_file, size, mtime, added_at, seen_at, missing)
           VALUES('evil','evil','x','x','book','[]','[]',?,1,?,?,?,0)""",
        ("../" * 12 + "etc/passwd", now, now, now),
    )
    db.commit()

    with pytest.raises(OutsideLibrary):
        resolve_target("evil", db)


def test_resolve_target_unknown_key(db: sqlite3.Connection) -> None:
    with pytest.raises(BookNotFound):
        resolve_target("нет такого", db)
