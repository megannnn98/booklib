"""PWA: manifest, service worker, иконки, безопасность."""

from __future__ import annotations

import struct
from pathlib import Path

from fastapi.testclient import TestClient

from booklib.api.app import app
from booklib.db import connect
from booklib.grouping import collect_groups
from booklib.scanner import sync
from tests.conftest import make_book


def client() -> TestClient:
    return TestClient(app, client=("127.0.0.1", 52000))


def remote() -> TestClient:
    return TestClient(app, client=("192.168.0.50", 50000))


OWN_PAGE = {"X-Booklib": "1"}
PROXIED = {"X-Forwarded-For": "192.168.0.50"}


def _png_dimensions(path: Path) -> tuple[int, int]:
    raw = path.read_bytes()
    w, h = struct.unpack(">II", raw[16:24])
    return w, h


# ---------- manifest ----------


def test_manifest_content_type() -> None:
    r = client().get("/static/manifest.webmanifest")
    assert r.status_code == 200
    assert "application/manifest+json" in r.headers["content-type"]


def test_manifest_fields() -> None:
    data = client().get("/static/manifest.webmanifest").json()
    assert data["name"] == "Booklib"
    assert data["short_name"] == "Booklib"
    assert data["start_url"] == "/"
    assert data["scope"] == "/"
    assert data["display"] == "standalone"
    assert data["lang"] == "ru"
    assert data["dir"] == "ltr"
    assert "background_color" in data
    assert "theme_color" in data


def test_manifest_icons_exist_and_match_sizes() -> None:
    data = client().get("/static/manifest.webmanifest").json()
    icons = data["icons"]
    assert len(icons) >= 2

    static_dir = Path(__file__).parents[2] / "src" / "booklib" / "api" / "static"

    for icon in icons:
        r = client().get(icon["src"])
        assert r.status_code == 200, f"иконка {icon['src']} недоступна"
        assert r.headers["content-type"].startswith("image/png")

        rel = icon["src"].replace("/static/", "", 1)
        icon_path = static_dir / rel

        for size_str in icon["sizes"].split():
            w, h = (int(x) for x in size_str.split("x"))
            actual_w, actual_h = _png_dimensions(icon_path)
            assert (actual_w, actual_h) == (w, h), (
                f"{icon['src']}: заявлен {w}x{h}, фактический {actual_w}x{actual_h}"
            )


def test_manifest_has_maskable_icon() -> None:
    data = client().get("/static/manifest.webmanifest").json()
    maskable = [i for i in data["icons"] if "maskable" in i.get("purpose", "")]
    assert len(maskable) >= 1


# ---------- service worker ----------


def test_service_worker_accessible_at_root_scope() -> None:
    r = client().get("/sw.js")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/javascript"
    assert "Cache-Control" in r.headers
    assert "no-cache" in r.headers["Cache-Control"]


def test_service_worker_skips_api_before_respond_with() -> None:
    """SW должен проверять /api/ и возвращаться ДО любого event.respondWith.

    Структурная проверка: в обработчике fetch первая проверка — startsWith('/api/'),
    за ней следует return, и только потом встречается первый respondWith.
    """
    sw = client().get("/sw.js").text

    fetch_handler_start = sw.index('addEventListener("fetch"')
    fetch_body = sw[fetch_handler_start:]

    api_check_pos = fetch_body.index('startsWith("/api/")')
    first_return_after_api = fetch_body.index("return", api_check_pos)
    first_respond_with = fetch_body.index("respondWith")

    assert api_check_pos < first_return_after_api < first_respond_with, (
        "SW: проверка /api/ и return должны быть ПЕРЕД первым respondWith"
    )


def test_service_worker_skips_range_before_respond_with() -> None:
    """SW должен пропускать Range-запросы до respondWith — не ломать скачивание."""
    sw = client().get("/sw.js").text

    fetch_handler_start = sw.index('addEventListener("fetch"')
    fetch_body = sw[fetch_handler_start:]

    range_check_pos = fetch_body.index('"Range"')
    first_return_after_range = fetch_body.index("return", range_check_pos)
    first_respond_with = fetch_body.index("respondWith")

    assert range_check_pos < first_return_after_range < first_respond_with, (
        "SW: проверка Range и return должны быть ПЕРЕД первым respondWith"
    )


# ---------- HTML подключает manifest и SW ----------


def test_html_includes_manifest_link() -> None:
    r = client().get("/")
    assert r.status_code == 200
    html = r.text
    assert 'rel="manifest"' in html
    assert "manifest.webmanifest" in html


def test_html_includes_sw_registration() -> None:
    js = client().get("/static/app.js").text
    assert "serviceWorker" in js
    assert "sw.js" in js


def test_html_has_theme_color_meta() -> None:
    html = client().get("/").text
    assert "theme-color" in html


def test_html_has_apple_touch_icon() -> None:
    html = client().get("/").text
    assert "apple-touch-icon" in html


# ---------- существующие API и безопасность не сломаны ----------


def test_remote_still_blocked_from_privileged_routes(library: Path) -> None:
    make_book(library, "a.pdf")
    r = remote()
    for method, path, body in [
        ("post", "/api/rescan", None),
        ("get", "/api/settings", None),
        ("post", "/api/settings", {"root": str(library)}),
        ("post", "/api/open", {"key": "x"}),
        ("post", "/api/book", {"key": "x", "title": "y"}),
    ]:
        resp = (
            r.get(path, headers=OWN_PAGE)
            if method == "get"
            else r.request(method, path, json=body, headers=OWN_PAGE)
        )
        assert resp.status_code == 403, f"{method} {path} → {resp.status_code}, а должен 403"


def test_remote_can_still_read_catalog(library: Path) -> None:
    make_book(library, "a.pdf")
    r = remote()
    assert r.get("/api/status").status_code == 200
    assert r.get("/api/books").status_code == 200
    assert r.get("/api/sections").status_code == 200


def test_sw_not_cached_by_browser() -> None:
    r = client().get("/sw.js")
    cc = r.headers.get("Cache-Control", "")
    assert "no-cache" in cc or "no-store" in cc


def test_service_worker_cache_cleanup_uses_prefix() -> None:
    """SW должен удалять только кэши с префиксом booklib-, не трогать чужие."""
    sw = client().get("/sw.js").text
    assert 'const CACHE_VERSION = "booklib-sw-v3"' in sw
    assert 'startsWith("booklib-")' in sw


# ---------- прокси-заголовок и определение клиента ----------


def test_direct_loopback_is_local() -> None:
    """Прямой loopback без proxy-маркера → admin и host desktop."""
    c = client()
    status = c.get("/api/status").json()
    assert status["local"] is True
    assert status["host_desktop"] is True


def test_trusted_proxy_is_local_and_keeps_admin_controls() -> None:
    """Caddy допускает только доверенную LAN и передаёт Admin с loopback-peer."""
    c = client()
    headers = OWN_PAGE | PROXIED | {"X-Booklib-Admin": "1"}
    status = c.get("/api/status", headers=headers).json()
    assert status["local"] is True
    assert status["host_desktop"] is False
    assert "root" in status and "db" in status
    assert c.get("/api/settings", headers=headers).status_code == 200

    index = c.get("/").text
    for control_id in ("settingsBtn", "tagsAdminBtn", "rescan"):
        assert f'id="{control_id}"' in index


def test_host_desktop_proxy_can_open_host_file_manager() -> None:
    """Только Caddy Desktop-маркер отличает хост через HTTPS от trusted телефона."""
    c = client()
    headers = OWN_PAGE | PROXIED | {"X-Booklib-Admin": "1", "X-Booklib-Desktop": "1"}
    status = c.get("/api/status", headers=headers).json()
    assert status["local"] is True
    assert status["host_desktop"] is True


def test_remote_marker_beats_desktop_marker() -> None:
    """Противоречивые маркеры fail closed: проводник не запускается."""
    c = client()
    headers = {"X-Booklib-Desktop": "1", "X-Booklib-Remote": "1"}
    assert c.get("/api/status", headers=headers).json()["host_desktop"] is False


def test_non_loopback_cannot_fake_desktop_marker() -> None:
    """Desktop-маркер не доверяется без loopback-peer локального Caddy."""
    status = remote().get("/api/status", headers={"X-Booklib-Desktop": "1"}).json()
    assert status["host_desktop"] is False


def test_pwa_opens_files_without_host_desktop_marker() -> None:
    """Admin trusted LAN не является признаком ПК: карточка открывает форматы."""
    js = client().get("/static/app.js").text
    assert "state.hostDesktop = status.host_desktop === true" in js
    assert "state.hostDesktop ? openBook(book) : openFiles(book)" in js


def test_proxied_request_without_marker_is_remote() -> None:
    """Прокси без собственного маркера fail-closed и не открывает admin API."""
    c = client()
    status = c.get("/api/status", headers=PROXIED).json()
    assert status["local"] is False
    assert "root" not in status and "db" not in status
    assert c.get("/api/settings", headers=OWN_PAGE | PROXIED).status_code == 403


def test_remote_marker_beats_admin_marker() -> None:
    """Противоречивые Caddy-маркеры не дают административных прав."""
    c = client()
    headers = PROXIED | {"X-Booklib-Admin": "1", "X-Booklib-Remote": "1"}
    assert c.get("/api/status", headers=headers).json()["local"] is False


def test_loopback_with_proxy_header_is_remote() -> None:
    """Loopback с X-Booklib-Remote: 1 → local=false (проксированный удалённый)."""
    c = client()
    status = c.get("/api/status", headers={"X-Booklib-Remote": "1"}).json()
    assert status["local"] is False


def test_remote_ip_without_header_is_remote() -> None:
    """Удалённый IP без маркера → local=false."""
    r = remote()
    status = r.get("/api/status").json()
    assert status["local"] is False


def test_remote_ip_cannot_fake_local_with_header() -> None:
    """Удалённый IP не может повысить права поддельным заголовком."""
    r = remote()
    status = r.get("/api/status", headers={"X-Booklib-Remote": "0"}).json()
    assert status["local"] is False


def test_non_loopback_cannot_fake_admin_header() -> None:
    """Admin-маркер от клиента, который не является локальным Caddy, не доверяется."""
    r = remote()
    headers = OWN_PAGE | {"X-Booklib-Admin": "1"}
    assert r.get("/api/status", headers=headers).json()["local"] is False
    assert r.post("/api/rescan", headers=headers).status_code == 403


def test_forwarded_for_cannot_fake_trusted_proxy() -> None:
    """X-Forwarded-For не является источником прав, даже если указывает loopback."""
    r = remote()
    headers = OWN_PAGE | {"X-Forwarded-For": "127.0.0.1", "X-Booklib-Admin": "1"}
    assert r.get("/api/status", headers=headers).json()["local"] is False
    assert r.post("/api/rescan", headers=headers).status_code == 403


def test_duplicate_header_cannot_bypass_proxy_marker() -> None:
    """Дублирующий заголовок X-Booklib-Remote: 0 перед 1 не обходит маркер.

    Защита от атаки: если клиент добавляет X-Booklib-Remote: 0 перед маркером
    Caddy (1), getlist() проверяет все значения и всё равно считает запрос
    удалённым, если хотя бы одно значение равно "1".
    """
    c = client()
    # httpx позволяет передать список значений для одного заголовка
    status = c.get(
        "/api/status",
        headers=[("X-Booklib-Remote", "0"), ("X-Booklib-Remote", "1")],
    ).json()
    assert status["local"] is False


def test_duplicate_header_reverse_order_also_remote() -> None:
    """Дублирующий заголовок в обратном порядке (1, 0) тоже считается удалённым."""
    c = client()
    status = c.get(
        "/api/status",
        headers=[("X-Booklib-Remote", "1"), ("X-Booklib-Remote", "0")],
    ).json()
    assert status["local"] is False


def test_proxied_request_hides_absolute_paths() -> None:
    """Проксированный запрос не получает абсолютные пути root и db."""
    c = client()
    status = c.get("/api/status", headers={"X-Booklib-Remote": "1"}).json()
    assert "root" not in status
    assert "db" not in status


# ---------- доступ к API для проксированного удалённого клиента ----------


def test_proxied_remote_can_read_tags(library: Path) -> None:
    """Проксированный удалённый клиент может читать теги (GET /api/tags)."""
    make_book(library, "a.pdf")
    c = client()
    r = c.get("/api/tags", headers={"X-Booklib-Remote": "1"})
    assert r.status_code == 200


def test_proxied_remote_can_read_catalog(library: Path) -> None:
    """Проксированный удалённый клиент может читать каталог."""
    make_book(library, "a.pdf")
    c = client()
    r = c.get("/api/books", headers={"X-Booklib-Remote": "1"})
    assert r.status_code == 200


def test_proxied_remote_can_download(library: Path) -> None:
    """Проксированный удалённый клиент может скачивать файлы."""
    make_book(library, "math/Книга.pdf", b"%PDF-1.4 fake\n%%EOF\n")
    conn = connect()
    sync(conn, collect_groups())
    conn.commit()
    conn.close()

    c = client()
    r = c.get(
        "/api/download",
        params={"key": "math/Книга", "file": "math/Книга.pdf"},
        headers={"X-Booklib-Remote": "1"},
    )
    assert r.status_code == 200


def test_proxied_remote_blocked_from_open(library: Path) -> None:
    """Проксированный удалённый клиент не может вызывать /api/open."""
    make_book(library, "a.pdf")
    c = client()
    r = c.post("/api/open", json={"key": "a"}, headers=OWN_PAGE | {"X-Booklib-Remote": "1"})
    assert r.status_code == 403


def test_proxied_remote_blocked_from_rescan(library: Path) -> None:
    """Проксированный удалённый клиент не может вызывать /api/rescan."""
    c = client()
    r = c.post("/api/rescan", headers=OWN_PAGE | {"X-Booklib-Remote": "1"})
    assert r.status_code == 403


def test_proxied_remote_blocked_from_settings(library: Path) -> None:
    """Проксированный удалённый клиент не может читать/менять настройки."""
    c = client()
    r = c.get("/api/settings", headers=OWN_PAGE | {"X-Booklib-Remote": "1"})
    assert r.status_code == 403
    r = c.post("/api/settings", json={"root": "/tmp"}, headers=OWN_PAGE | {"X-Booklib-Remote": "1"})
    assert r.status_code == 403


def test_proxied_remote_blocked_from_edit_book(library: Path) -> None:
    """Проксированный удалённый клиент не может править книги."""
    make_book(library, "a.pdf")
    c = client()
    r = c.post(
        "/api/book",
        json={"key": "a", "title": "Правка"},
        headers=OWN_PAGE | {"X-Booklib-Remote": "1"},
    )
    assert r.status_code == 403


def test_proxied_remote_blocked_from_tag_mutations(library: Path) -> None:
    """Проксированный удалённый клиент не может создавать/менять/удалять теги."""
    c = client()
    headers = OWN_PAGE | {"X-Booklib-Remote": "1"}
    r = c.post("/api/tags", json={"name": "test"}, headers=headers)
    assert r.status_code == 403
    r = c.put("/api/tags/1", json={"name": "test"}, headers=headers)
    assert r.status_code == 403
    r = c.delete("/api/tags/1", headers=headers)
    assert r.status_code == 403


def test_direct_loopback_can_edit_book(library: Path) -> None:
    """Прямой loopback без маркера сохраняет административные возможности."""
    make_book(library, "math/Книга.pdf", b"%PDF-1.4 fake\n%%EOF\n")
    conn = connect()
    sync(conn, collect_groups())
    conn.commit()
    conn.close()

    c = client()
    r = c.post(
        "/api/book",
        json={"key": "math/Книга", "title": "Правка"},
        headers=OWN_PAGE,
    )
    assert r.status_code == 200  # прямой loopback имеет права на редактирование
