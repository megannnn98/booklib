"""Регрессии по итогам внешнего code review.

Каждый тест соответствует конкретной находке: если убрать исправление, тест краснеет.
"""

from __future__ import annotations

import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from booklib import covers
from booklib.api.app import app, rescan
from booklib.db import connect
from booklib.grouping import collect_groups
from booklib.opener import OutsideLibrary, _file_uri, resolve_target
from booklib.scanner import sync
from booklib.taxonomy import apply as apply_sections
from tests.conftest import make_book

OWN_PAGE = {"X-Booklib": "1"}
KEY = "philosophy/Эвола - Даосизм - 2020"


@pytest.fixture
def client(library: Path, db: sqlite3.Connection) -> TestClient:
    make_book(library, "philosophy/Эвола - Даосизм - 2020.pdf")
    make_book(library, "programming/Книга про C++ и x86_64 - 2020.pdf")
    make_book(library, "programming/Скидка 100% на всё - 2021.pdf")
    make_book(library, "programming/Про x86y64 без подчёркивания - 2019.pdf")
    sync(db, collect_groups())
    apply_sections(db)
    db.commit()
    return TestClient(app)


# ---------- F1: правка одного поля не должна копировать остальные ----------


def test_editing_only_section_does_not_freeze_title(
    client: TestClient, db: sqlite3.Connection
) -> None:
    """Форма шлёт все три поля; в overrides должно попасть только изменённое.

    Иначе значение из taxonomy.json копируется в overrides и «цементируется»:
    перегенерация раскладки до карточки больше не достучится.
    """
    client.post(
        "/api/book",
        json={"key": KEY, "title": "Даосизм", "author": None, "section": "Свой раздел"},
        headers=OWN_PAGE,
    )

    row = db.execute(
        "SELECT title, author, section FROM overrides WHERE key = ?", (KEY,)
    ).fetchone()
    assert row["section"] == "Свой раздел"
    assert row["title"] is None, "название из таксономии залипло в overrides"
    assert row["author"] is None


def test_editing_section_preserves_existing_title_override(
    client: TestClient, db: sqlite3.Connection
) -> None:
    """Сравнивать надо с базовым значением, а не со склеенным.

    Иначе повторная правка раздела затирала бы уже существующую правку названия:
    форма пришлёт тот же title, он совпадёт со склеенным значением и обнулится.
    """
    client.post("/api/book", json={"key": KEY, "title": "Мой заголовок"}, headers=OWN_PAGE)
    client.post(
        "/api/book",
        json={"key": KEY, "title": "Мой заголовок", "section": "Другой раздел"},
        headers=OWN_PAGE,
    )

    row = db.execute("SELECT title, section FROM overrides WHERE key = ?", (KEY,)).fetchone()
    assert row["title"] == "Мой заголовок", "правка названия потеряна"
    assert row["section"] == "Другой раздел"


def test_taxonomy_change_reaches_card_without_override(
    client: TestClient, db: sqlite3.Connection
) -> None:
    """Сквозная проверка смысла F1: после правки только раздела новое название доезжает."""
    client.post("/api/book", json={"key": KEY, "section": "Свой раздел"}, headers=OWN_PAGE)
    db.execute("UPDATE books SET title = ? WHERE key = ?", ("Даосизм (2-е изд.)", KEY))
    db.commit()

    book = next(b for b in client.get("/api/books").json()["books"] if b["key"] == KEY)
    assert book["title"] == "Даосизм (2-е изд.)"
    assert book["section"] == "Свой раздел"


# ---------- F4: маркировка пропавших без плейсхолдера на карточку ----------


def test_missing_marking_uses_no_per_card_placeholders(
    library: Path, db: sqlite3.Connection
) -> None:
    """`key NOT IN (?,?,...)` упирался в SQLITE_MAX_VARIABLE_NUMBER (32766)."""
    for number in range(30):
        make_book(library, f"book{number:03d}.pdf")

    statements: list[str] = []
    db.set_trace_callback(statements.append)
    sync(db, collect_groups())
    db.set_trace_callback(None)

    marking = [s for s in statements if "missing=1" in s.replace(" ", "")]
    assert marking, "запрос маркировки пропавших не найден"
    assert all("NOT IN" not in s.upper() for s in marking)
    assert all(s.count("?") <= 1 for s in marking)


def test_missing_marking_still_correct_at_scale(library: Path, db: sqlite3.Connection) -> None:
    for number in range(200):
        make_book(library, f"book{number:03d}.pdf")
    sync(db, collect_groups())

    (library / "book007.pdf").unlink()
    stats = sync(db, collect_groups())

    assert stats["missing"] == 1
    assert db.execute("SELECT COUNT(*) AS n FROM books WHERE missing = 1").fetchone()["n"] == 1


# ---------- F5: wildcard'ы LIKE ----------


def test_percent_in_query_is_not_a_wildcard(client: TestClient) -> None:
    """Одиночный % без экранирования матчит вообще всё — это и отличает баг от фикса."""
    everything = client.get("/api/books").json()["total"]
    found = client.get("/api/books", params={"q": "%"}).json()

    assert everything == 4
    assert found["total"] == 1, "wildcard расширил выдачу вместо поиска литерала"
    assert found["books"][0]["title"].startswith("Скидка 100%")


def test_underscore_in_query_is_literal(client: TestClient) -> None:
    """В каталоге есть и x86_64, и x86y64: без ESCAPE запрос x86_64 нашёл бы обе."""
    found = client.get("/api/books", params={"q": "x86_64"}).json()

    assert found["total"] == 1
    assert "x86_64" in found["books"][0]["key"]


# ---------- F7: устаревшая обложка ----------


def test_cover_not_served_when_catalog_says_it_is_stale(
    client: TestClient, db: sqlite3.Connection
) -> None:
    """После правки книги has_cover=0, но старый jpg ещё лежит на диске."""
    path = covers.cover_path(KEY)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\xff\xd8\xff\xe0stale")
    db.execute("UPDATE books SET has_cover = 0 WHERE key = ?", (KEY,))
    db.commit()

    assert client.get("/api/cover", params={"key": KEY}).status_code == 404


def test_changed_file_clears_cover_error(library: Path, db: sqlite3.Connection) -> None:
    book = make_book(library, "a.pdf")
    sync(db, collect_groups())
    db.execute("UPDATE books SET cover_error = 'старая причина', has_cover = 1")
    db.commit()

    book.write_bytes(b"%PDF-1.4 changed content\n%%EOF\n")
    sync(db, collect_groups())

    row = db.execute("SELECT has_cover, cover_error FROM books").fetchone()
    assert (row["has_cover"], row["cover_error"]) == (0, None)


# ---------- F2/F6: конкурентность ----------


def test_concurrent_rescan_does_not_raise(library: Path) -> None:
    """Двойной клик по «Обновить» запускал два скана разом: два писателя в СУБД."""
    for number in range(20):
        make_book(library, f"book{number:02d}.pdf")

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: rescan(), range(4)))

    assert len(results) == 4
    assert sum(r["added"] for r in results) == 20, "карточки должны быть добавлены ровно один раз"


def test_connect_is_idempotent_across_threads(tmp_path: Path) -> None:
    """PRAGMA table_info + ALTER TABLE не атомарны — второй ALTER падал дубликатом."""
    db_path = tmp_path / "cache" / "concurrent.db"

    def open_and_describe(_: int) -> set[str]:
        # соединение sqlite нельзя использовать вне своего потока, поэтому
        # открываем и проверяем схему прямо здесь
        conn = connect(db_path)
        try:
            return {row["name"] for row in conn.execute("PRAGMA table_info(books)")}
        finally:
            conn.close()

    with ThreadPoolExecutor(max_workers=8) as pool:
        schemas = list(pool.map(open_and_describe, range(8)))

    assert all("cover_error" in columns for columns in schemas)


def test_wal_is_enabled(db: sqlite3.Connection) -> None:
    assert db.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"


# ---------- F9 / symlinks: пути ----------


def test_file_uri_encodes_quote_and_backslash(tmp_path: Path) -> None:
    uri = _file_uri(tmp_path / "Возвратные'последовательности\\том.djvu")

    assert "'" not in uri and "\\" not in uri
    assert "%27" in uri and "%5C" in uri


def test_symlink_pointing_outside_library_is_rejected(
    library: Path, db: sqlite3.Connection, tmp_path: Path
) -> None:
    """Проверка идёт по resolve(), поэтому симлинк наружу должен отбиваться."""
    outside = tmp_path / "секрет.pdf"
    outside.write_bytes(b"%PDF-1.4\n%%EOF\n")
    (library / "ссылка.pdf").symlink_to(outside)
    sync(db, collect_groups())

    with pytest.raises(OutsideLibrary):
        resolve_target("ссылка", db)


def test_regular_file_inside_library_resolves(library: Path, db: sqlite3.Connection) -> None:
    make_book(library, "PLPM/01-Vozvratnye.djvu")
    sync(db, collect_groups())

    assert resolve_target("PLPM/01-Vozvratnye", db).name == "01-Vozvratnye.djvu"


# ---------- api_edit: край «всё пусто» ----------


def test_clearing_all_fields_removes_override_row(
    client: TestClient, db: sqlite3.Connection
) -> None:
    client.post("/api/book", json={"key": KEY, "title": "Мой заголовок"}, headers=OWN_PAGE)
    client.post(
        "/api/book",
        json={"key": KEY, "title": "", "author": "", "section": ""},
        headers=OWN_PAGE,
    )

    assert db.execute("SELECT COUNT(*) AS n FROM overrides").fetchone()["n"] == 0


def test_unknown_sort_falls_back_instead_of_failing(client: TestClient) -> None:
    assert client.get("/api/books", params={"sort": "'; DROP TABLE books; --"}).status_code == 200
    assert db_has_books(client)


def db_has_books(client: TestClient) -> bool:
    return client.get("/api/books").json()["total"] > 0


def test_edit_updates_timestamp(client: TestClient, db: sqlite3.Connection) -> None:
    before = time.time()
    client.post("/api/book", json={"key": KEY, "title": "Заголовок"}, headers=OWN_PAGE)

    updated_at = db.execute("SELECT updated_at FROM overrides WHERE key = ?", (KEY,)).fetchone()[0]
    assert updated_at >= before
