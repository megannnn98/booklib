"""Доступ из локальной сети: роли клиента, лист файлов, скачивание.

Витрина слушает сеть (BOOKLIB_HOST=0.0.0.0), поэтому привилегированные ручки
(правки, настройки, nemo) закрыты require_local — только с петли. Удалённый
клиент получает public-ручки (каталог, обложки, лист файлов, скачивание).
Роль моделируется через IP клиента: remote — произвольный внешний адрес,
local — 127.0.0.1 (дефолтный TestClient отдаёт host='testclient', петлей не
числящийся, поэтому локальные клиенты заданы явно).
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from booklib.api.app import app
from booklib.grouping import collect_groups
from booklib.scanner import sync
from tests.conftest import make_book

OWN_PAGE = {"X-Booklib": "1"}


def local_client() -> TestClient:
    return TestClient(app, client=("127.0.0.1", 52000))


def remote_client() -> TestClient:
    return TestClient(app, client=("192.168.0.50", 50000))


# ---------- роли: привилегированные ручки ----------


def test_remote_is_blocked_from_privileged_routes(library: Path) -> None:
    """Удалённый клиент не может менять настройки, сканировать, открывать nemo."""
    remote = remote_client()
    make_book(library, "a.pdf")
    for method, path, body in [
        ("get", "/api/settings", None),
        ("get", "/api/settings/preview?root=/", None),
        ("post", "/api/settings", {"root": str(library)}),
        ("post", "/api/rescan", None),
        ("post", "/api/open", {"key": "x"}),
        ("post", "/api/book", {"key": "x", "title": "y"}),
    ]:
        resp = (
            remote.get(path, params=body, headers=OWN_PAGE)
            if method == "get" and path.startswith("/api/settings/preview")
            else remote.request(method, path, json=body, headers=OWN_PAGE)
        )
        assert resp.status_code == 403, f"{method} {path} → {resp.status_code}, а должен 403"


def test_local_is_allowed_privileged(library: Path) -> None:
    make_book(library, "a.pdf")
    local = local_client()
    # правка до скана — 404 (карточки нет), но НЕ 403: до привилегий локальный достучался
    resp = local.post("/api/book", json={"key": "a", "title": "Правка"}, headers=OWN_PAGE)
    assert resp.status_code == 404


def test_local_without_header_is_403(library: Path) -> None:
    local = local_client()
    # даже локально — без X-Booklib привилегии не открываются (второй слой)
    assert local.post("/api/rescan").status_code == 403


# ---------- роль в /api/status ----------


def test_status_local_flag_and_paths(library: Path) -> None:
    make_book(library, "a.pdf")
    remote = remote_client()
    local = local_client()

    rs = remote.get("/api/status").json()
    assert rs["local"] is False
    assert "root" not in rs and "db" not in rs  # абсолютные пути ФС не гостю

    rl = local.get("/api/status").json()
    assert rl["local"] is True
    assert "root" in rl and "db" in rl


# ---------- public-ручки доступны удалённому ----------


def test_remote_can_read_catalog_and_covers(library: Path, db: sqlite3.Connection) -> None:
    make_book(library, "math/Тестовая Книга.pdf")
    sync(db, collect_groups())
    db.commit()
    remote = remote_client()

    assert remote.get("/api/status").status_code == 200
    assert remote.get("/api/books").json()["total"] == 1
    assert remote.get("/api/sections").status_code == 200


# ---------- лист файлов ----------


def test_files_lists_formats_in_primary_order(library: Path, db: sqlite3.Connection) -> None:
    make_book(library, "math/Книга.pdf")
    make_book(library, "math/Книга.epub")
    make_book(library, "math/Книга.fb2")
    sync(db, collect_groups())
    db.commit()

    files = remote_client().get("/api/files", params={"key": "math/Книга"}).json()

    # тот же порядок, что у primary_file: pdf → epub → fb2
    assert [f["format"] for f in files] == ["pdf", "epub", "fb2"]
    assert files[0]["name"] == "Книга.pdf"


def test_files_unknown_key_is_404(library: Path) -> None:
    assert remote_client().get("/api/files", params={"key": "nope"}).status_code == 404


# ---------- скачивание ----------


def test_download_serves_file_with_attachment(library: Path, db: sqlite3.Connection) -> None:
    make_book(library, "math/Книга.pdf", b"%PDF-1.4 fake\n%%EOF\n")
    sync(db, collect_groups())
    db.commit()

    r = remote_client().get("/api/download", params={"key": "math/Книга", "file": "math/Книга.pdf"})

    assert r.status_code == 200
    assert r.content == b"%PDF-1.4 fake\n%%EOF\n"
    assert r.headers["content-disposition"].startswith("attachment")


def test_download_supports_range(library: Path, db: sqlite3.Connection) -> None:
    make_book(library, "big.pdf", b"A" * 1000)
    sync(db, collect_groups())
    db.commit()

    r = remote_client().get(
        "/api/download",
        params={"key": "big", "file": "big.pdf"},
        headers={"Range": "bytes=0-99"},
    )

    assert r.status_code == 206
    assert len(r.content) == 100
    assert r.headers.get("accept-ranges") == "bytes"


def test_download_file_not_in_card_is_403(library: Path, db: sqlite3.Connection) -> None:
    make_book(library, "a.pdf")
    make_book(library, "b.pdf")
    sync(db, collect_groups())
    db.commit()

    # b.pdf — отдельная карточка, в карточку a не входит
    r = remote_client().get("/api/download", params={"key": "a", "file": "b.pdf"})
    assert r.status_code == 403


def test_download_traversal_is_403(library: Path, db: sqlite3.Connection) -> None:
    make_book(library, "a.pdf")
    sync(db, collect_groups())
    db.commit()

    r = remote_client().get("/api/download", params={"key": "a", "file": "../../etc/passwd"})
    assert r.status_code == 403


def test_download_traversal_even_if_in_files_json_is_403(
    library: Path, db: sqlite3.Connection
) -> None:
    """is_relative_to — второй, независимый guard: файл в files_json, но путь ведёт наружу.

    Нормальный скан так не запишет (files_json строится через relative_to_root),
    но это defense-in-depth: если whitelist пройден по поддельной СУБД, resolve +
    is_relative_to всё равно обязан отбить. Мутация: убрать is_relative_to —
    этот тест краснеет (в отличие от test_download_traversal_is_403, который
    ловит whitelist).
    """
    make_book(library, "a.pdf")
    sync(db, collect_groups())
    db.execute(
        "UPDATE books SET files_json = ? WHERE key = ?",
        (json.dumps(["../../etc/passwd"]), "a"),
    )
    db.commit()

    r = remote_client().get("/api/download", params={"key": "a", "file": "../../etc/passwd"})
    assert r.status_code == 403


def test_download_unknown_key_is_404(library: Path) -> None:
    r = remote_client().get("/api/download", params={"key": "nope", "file": "x"})
    assert r.status_code == 404


def test_download_missing_on_disk_is_503(library: Path, db: sqlite3.Connection) -> None:
    make_book(library, "a.pdf")
    sync(db, collect_groups())
    db.commit()
    (library / "a.pdf").unlink()  # файл исчез (диск отключён?)

    r = remote_client().get("/api/download", params={"key": "a", "file": "a.pdf"})
    assert r.status_code in (403, 503)  # stat проваливается → 503; либо файл не в ФС
