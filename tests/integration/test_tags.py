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


def test_tag_description_semantics_via_api(library: Path, db: sqlite3.Connection) -> None:
    client = _client(library, db)

    blank = client.post(
        "/api/tags",
        json={"name": "Гегель", "kind": "topic", "description": ""},
        headers=OWN_PAGE,
    ).json()
    null_desc = client.post(
        "/api/tags",
        json={"name": "Философия", "kind": "topic", "description": None},
        headers=OWN_PAGE,
    ).json()
    missing = client.post(
        "/api/tags",
        json={"name": "Диалектика", "kind": "topic"},
        headers=OWN_PAGE,
    ).json()

    assert blank["description"] is None
    assert null_desc["description"] is None
    assert missing["description"] is None
    assert (
        db.execute("SELECT description FROM tags WHERE id = ?", (blank["id"],)).fetchone()[0]
        is None
    )
    assert (
        db.execute("SELECT description FROM tags WHERE id = ?", (null_desc["id"],)).fetchone()[0]
        is None
    )
    assert (
        db.execute("SELECT description FROM tags WHERE id = ?", (missing["id"],)).fetchone()[0]
        is None
    )


def test_tag_description_can_be_cleared_and_preserved_via_api(
    library: Path, db: sqlite3.Connection
) -> None:
    client = _client(library, db)
    created = client.post(
        "/api/tags",
        json={"name": "Гегель", "kind": "topic", "description": "немецкая философия"},
        headers=OWN_PAGE,
    ).json()

    cleared = client.put(
        f"/api/tags/{created['id']}",
        json={"description": ""},
        headers=OWN_PAGE,
    ).json()
    assert cleared["description"] is None

    restored = client.put(
        f"/api/tags/{created['id']}",
        json={"name": "Диалектика", "kind": "person", "description": "новое"},
        headers=OWN_PAGE,
    ).json()
    assert restored["description"] == "новое"

    preserved = client.put(
        f"/api/tags/{created['id']}",
        json={"name": "Логика"},
        headers=OWN_PAGE,
    ).json()
    assert preserved["description"] == "новое"


def test_empty_name_kind_and_alias_are_rejected_via_api(
    library: Path, db: sqlite3.Connection
) -> None:
    client = _client(library, db)
    tag = client.post(
        "/api/tags",
        json={"name": "Гегель", "kind": "topic"},
        headers=OWN_PAGE,
    ).json()

    assert (
        client.post(
            "/api/tags", json={"name": "   ", "kind": "topic"}, headers=OWN_PAGE
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/tags", json={"name": "Новый", "kind": "   "}, headers=OWN_PAGE
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/tags/{tag['id']}/aliases", json={"alias": "   "}, headers=OWN_PAGE
        ).status_code
        == 400
    )


def test_alias_matching_canonical_name_conflicts_via_api(
    library: Path, db: sqlite3.Connection
) -> None:
    client = _client(library, db)
    tag = client.post(
        "/api/tags",
        json={"name": "Диалектика", "kind": "topic"},
        headers=OWN_PAGE,
    ).json()

    assert (
        client.post(
            f"/api/tags/{tag['id']}/aliases",
            json={"alias": "диалектика"},
            headers=OWN_PAGE,
        ).status_code
        == 409
    )


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


# ---------- фильтрация: AND, совместимость с разделом и поиском ----------

DAO = "philosophy/Эвола - Даосизм - 2020"
LOGIC = "philosophy/Гегель - Наука логики - 1812"


def _make_tag(client: TestClient, name: str) -> dict:
    response = client.post("/api/tags", json={"name": name, "kind": "topic"}, headers=OWN_PAGE)
    assert response.status_code == 200, response.text
    return response.json()


def _assign(client: TestClient, key: str, names: list[str]) -> None:
    response = client.put(f"/api/book/{key}/tags", json={"tags": names}, headers=OWN_PAGE)
    assert response.status_code == 200, response.text


def _keys(payload: dict) -> set[str]:
    return {book["key"] for book in payload["books"]}


def test_several_tags_filter_by_and(library: Path, db: sqlite3.Connection) -> None:
    """Два ?tag= — это пересечение, а не объединение.

    Мутация: заменить пересечение на объединение (или потерять один EXISTS) —
    в выдаче окажется и «Даосизм», у которого второго тега нет.
    """
    client = _client(library, db)
    _make_tag(client, "Гегель")
    _make_tag(client, "диалектика")
    _assign(client, LOGIC, ["Гегель", "диалектика"])
    _assign(client, DAO, ["Гегель"])

    both = client.get("/api/books", params=[("tag", "Гегель"), ("tag", "диалектика")]).json()
    one = client.get("/api/books", params=[("tag", "Гегель")]).json()

    assert (both["total"], _keys(both)) == (1, {LOGIC})
    assert (one["total"], _keys(one)) == (2, {LOGIC, DAO})


def test_tag_filter_composes_with_section_and_search(library: Path, db: sqlite3.Connection) -> None:
    """Фильтр тегов складывается с разделом, поиском, сортировкой и пагинацией.

    Разделы ставим правкой карточки: raw taxonomy на временной библиотеке
    отправляет обе книги в «Новое», и проверка раздела была бы пустой.
    """
    client = _client(library, db)
    _make_tag(client, "Гегель")
    _assign(client, LOGIC, ["Гегель"])
    _assign(client, DAO, ["Гегель"])
    for key, section in ((LOGIC, "Философия"), (DAO, "Оккультизм")):
        assert (
            client.post(
                "/api/book", json={"key": key, "section": section}, headers=OWN_PAGE
            ).json()["action"]
            == "saved"
        )

    together = client.get(
        "/api/books",
        params=[("tag", "Гегель"), ("section", "Философия"), ("q", "логики"), ("sort", "title")],
    ).json()
    # каждое условие реально сужает: снимаем по одному и получаем другой набор
    without_section = client.get("/api/books", params=[("tag", "Гегель"), ("q", "логики")]).json()
    without_query = client.get(
        "/api/books", params=[("tag", "Гегель"), ("section", "Оккультизм")]
    ).json()

    assert (together["total"], _keys(together)) == (1, {LOGIC})
    assert _keys(without_section) == {LOGIC}
    assert _keys(without_query) == {DAO}
    # limit/offset считают от того же отфильтрованного набора
    page = client.get("/api/books", params=[("tag", "Гегель"), ("limit", 1), ("offset", 1)]).json()
    assert (page["total"], len(page["books"])) == (2, 1)


def test_search_finds_book_by_tag_name(library: Path, db: sqlite3.Connection) -> None:
    """q ищет и по имени тега, не только по алиасу: в названии книги слова нет."""
    client = _client(library, db)
    tag = _make_tag(client, "Диалектика")
    client.post(f"/api/tags/{tag['id']}/aliases", json={"alias": "метод"}, headers=OWN_PAGE)
    _assign(client, DAO, ["Диалектика"])

    by_name = client.get("/api/books", params={"q": "диалект"}).json()
    by_alias = client.get("/api/books", params={"q": "метод"}).json()

    assert (by_name["total"], _keys(by_name)) == (1, {DAO})
    assert (by_alias["total"], _keys(by_alias)) == (1, {DAO})


# ---------- теги против рескана и пропажи книги ----------


def test_tags_survive_rescan_and_book_disappearance(library: Path, db: sqlite3.Connection) -> None:
    """Настоящий рескан (не ручной UPDATE missing) не трогает ручные теги.

    Пропавшая книга уходит из count, но связь остаётся: вернулась — тег на месте.
    Мутация: заставить scanner.sync чистить book_tags — тест краснеет.
    """
    client = _client(library, db)
    _make_tag(client, "Гегель")
    _assign(client, LOGIC, ["Гегель"])

    assert client.post("/api/rescan", headers=OWN_PAGE).status_code == 200
    book = next(b for b in client.get("/api/books").json()["books"] if b["key"] == LOGIC)
    assert [tag["name"] for tag in book["tags"]] == ["Гегель"]
    assert client.get("/api/tags").json()[0]["count"] == 1

    (library / "philosophy/Гегель - Наука логики - 1812.pdf").unlink()
    assert client.post("/api/rescan", headers=OWN_PAGE).status_code == 200
    assert LOGIC not in _keys(client.get("/api/books").json())
    # тег не удалён и не осиротел — просто не считает пропавшую книгу
    assert client.get("/api/tags").json()[0]["count"] == 0

    make_book(library, "philosophy/Гегель - Наука логики - 1812.pdf")
    assert client.post("/api/rescan", headers=OWN_PAGE).status_code == 200
    restored = next(b for b in client.get("/api/books").json()["books"] if b["key"] == LOGIC)
    assert [tag["name"] for tag in restored["tags"]] == ["Гегель"]
    assert client.get("/api/tags").json()[0]["count"] == 1


def test_removing_tag_from_one_book_keeps_other_books(
    library: Path, db: sqlite3.Connection
) -> None:
    """Полная замена набора — это набор ОДНОЙ книги, а не всего тега."""
    client = _client(library, db)
    _make_tag(client, "Гегель")
    _assign(client, LOGIC, ["Гегель"])
    _assign(client, DAO, ["Гегель"])
    assert client.get("/api/tags").json()[0]["count"] == 2

    _assign(client, LOGIC, [])  # снять все теги у одной карточки

    books = {book["key"]: book["tags"] for book in client.get("/api/books").json()["books"]}
    assert books[LOGIC] == []
    assert [tag["name"] for tag in books[DAO]] == ["Гегель"]
    assert client.get("/api/tags").json()[0]["count"] == 1


def test_edit_and_tags_are_saved_atomically(library: Path, db: sqlite3.Connection) -> None:
    client = _client(library, db)
    tag = _make_tag(client, "Гегель")
    client.post(
        "/api/book",
        json={
            "key": LOGIC,
            "title": "Мой заголовок",
            "section": "Свой раздел",
            "tags": ["Гегель"],
        },
        headers=OWN_PAGE,
    )

    response = client.post(
        "/api/book",
        json={
            "key": LOGIC,
            "title": "Новый заголовок",
            "section": "Другой раздел",
            "tags": ["Гегель", "Неизвестный"],
        },
        headers=OWN_PAGE,
    )

    assert response.status_code == 404
    row = db.execute("SELECT title, section FROM overrides WHERE key = ?", (LOGIC,)).fetchone()
    assert (row["title"], row["section"]) == ("Мой заголовок", "Свой раздел")
    rows = db.execute(
        "SELECT bt.tag_id, bt.source FROM book_tags bt WHERE bt.book_key = ? ORDER BY bt.tag_id",
        (LOGIC,),
    ).fetchall()
    assert [(row["tag_id"], row["source"]) for row in rows] == [(tag["id"], "manual")]


def test_edit_saves_fields_and_tags_in_one_request(library: Path, db: sqlite3.Connection) -> None:
    client = _client(library, db)
    tag = _make_tag(client, "Гегель")

    response = client.post(
        "/api/book",
        json={
            "key": DAO,
            "title": "Мой заголовок",
            "section": "Свой раздел",
            "tags": ["Гегель"],
        },
        headers=OWN_PAGE,
    )

    assert response.json()["action"] == "saved"
    row = db.execute("SELECT title, section FROM overrides WHERE key = ?", (DAO,)).fetchone()
    assert (row["title"], row["section"]) == ("Мой заголовок", "Свой раздел")
    rows = db.execute(
        "SELECT tag_id, source FROM book_tags WHERE book_key = ? ORDER BY tag_id",
        (DAO,),
    ).fetchall()
    assert [(row["tag_id"], row["source"]) for row in rows] == [(tag["id"], "manual")]


def test_reset_clears_manual_overrides_and_keeps_auto_tags(
    library: Path, db: sqlite3.Connection
) -> None:
    client = _client(library, db)
    _make_tag(client, "Гегель")
    auto = _make_tag(client, "Диалектика")
    client.post(
        "/api/book",
        json={
            "key": LOGIC,
            "title": "Мой заголовок",
            "section": "Свой раздел",
            "tags": ["Гегель", "Диалектика"],
        },
        headers=OWN_PAGE,
    )
    db.execute("UPDATE book_tags SET source = 'auto' WHERE tag_id = ?", (auto["id"],))
    db.commit()

    response = client.post("/api/book", json={"key": LOGIC, "reset": True}, headers=OWN_PAGE)

    assert response.json()["action"] == "reset"
    assert (
        db.execute("SELECT COUNT(*) AS n FROM overrides WHERE key = ?", (LOGIC,)).fetchone()[0] == 0
    )
    rows = db.execute(
        "SELECT tag_id, source FROM book_tags WHERE book_key = ? ORDER BY tag_id",
        (LOGIC,),
    ).fetchall()
    assert [(row["tag_id"], row["source"]) for row in rows] == [(auto["id"], "auto")]
    book = next(item for item in client.get("/api/books").json()["books"] if item["key"] == LOGIC)
    assert (book["title"], book["section"]) == ("Наука логики", "Новое")
    assert [tag["name"] for tag in book["tags"]] == ["Диалектика"]
