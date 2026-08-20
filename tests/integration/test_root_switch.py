"""Смена корня: слот состояния на корень, миграция legacy, guard на свежем корне."""

from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient
from typer.testing import CliRunner

from booklib.api.app import app
from booklib.cli.app import app as cli_app
from booklib.config.settings import get_settings, write_runtime_config
from booklib.db import connect, connect_at, init_state
from booklib.grouping import collect_groups
from booklib.scanner import sync
from booklib.service import apply_root, rescan
from tests.conftest import make_book

OWN_PAGE = {"X-Booklib": "1"}
runner = CliRunner()


def test_switch_root_gets_own_slot(library: Path) -> None:
    """Другой корень — другой слот: одинаковый относительный путь в двух библиотеках
    — это одна строка по PRIMARY KEY, и один файл обложки (sha1 ключа без корня)."""
    make_book(library, "a.pdf")
    conn = connect()
    try:
        sync(conn, collect_groups())
        assert conn.execute("SELECT COUNT(*) AS n FROM books").fetchone()["n"] == 1
    finally:
        conn.close()
    first_slot = get_settings().slot_dir

    root2 = library.parent / "library2"
    root2.mkdir()
    make_book(root2, "b.pdf")
    write_runtime_config(root=str(root2))

    conn = connect()
    try:
        stats = sync(conn, collect_groups())
        assert stats["added"] == 1
        assert conn.execute("SELECT COUNT(*) AS n FROM books").fetchone()["n"] == 1
    finally:
        conn.close()

    assert get_settings().slot_dir != first_slot
    # старый слот не тронут: можно вернуться на прежний корень
    n = (
        sqlite3.connect(first_slot / "library.db")
        .execute("SELECT COUNT(*) FROM books")
        .fetchone()[0]
    )
    assert n == 1


def test_guard_does_not_fire_on_fresh_root(library: Path) -> None:
    """Свежий корень стартует с пустой СУБД (known = 0) — guard молчит, хотя книг нет."""
    make_book(library, "a.pdf")
    conn = connect()
    try:
        sync(conn, collect_groups())
    finally:
        conn.close()

    empty = library.parent / "empty"
    empty.mkdir()
    write_runtime_config(root=str(empty))
    conn = connect()
    try:
        stats = sync(conn, collect_groups())
        assert stats["missing"] == 0
    finally:
        conn.close()

    # возврат на населённый корень — guard работает как раньше
    write_runtime_config(root=str(library))
    conn = connect()
    try:
        stats = sync(conn, collect_groups())
        assert (stats["added"], stats["unchanged"]) == (0, 1)
    finally:
        conn.close()


def test_legacy_state_migrates_into_slot(library: Path) -> None:
    """Старая версия держала СУБД и обложки прямо в cache_dir — переносим в слот.

    Без этого 353 карточки и правки overrides «исчезли» бы после обновления.
    """
    make_book(library, "a.pdf")
    cache = get_settings().cache_dir
    legacy = cache / "library.db"
    conn = connect_at(legacy)  # так работала старая версия
    try:
        sync(conn, collect_groups())
    finally:
        conn.close()
    covers_dir = cache / "covers"
    covers_dir.mkdir()
    (covers_dir / "x.jpg").write_bytes(b"jpeg")

    init_state()  # новый код готовит состояние на старте процесса, а не в connect()
    conn = connect()
    try:
        n = conn.execute("SELECT COUNT(*) AS n FROM books").fetchone()["n"]
    finally:
        conn.close()

    assert n == 1
    assert not legacy.exists()
    assert get_settings().db_path.exists()
    assert (get_settings().slot_dir / "covers" / "x.jpg").exists()
    assert (get_settings().slot_dir / "root.txt").read_text() == str(library)


def test_legacy_state_does_not_cross_into_foreign_slot(library: Path) -> None:
    """Мутация F1: если миграция снова попадёт в connect(), она привяжет
    legacy-состояние к корню, выбранному в момент первого запроса — а не к тому,
    которому данные принадлежат.

    Сценарий из ревью: после обновления на корне A команда
    `booklib config --root /new` (или POST /api/settings до первого скана)
    вызывает connect() уже ПОСЛЕ записи нового корня B. Миграция внутри
    connect() перенесла бы СУБД и covers из cache_dir в слот B, и возврат на A
    получил бы пустую СУБД — overrides (невосстановимые) потеряны.
    """
    make_book(library, "a.pdf")
    cache = get_settings().cache_dir
    legacy = cache / "library.db"
    conn = connect_at(legacy)  # так работала старая версия
    try:
        sync(conn, collect_groups())
    finally:
        conn.close()
    (cache / "covers").mkdir(exist_ok=True)
    (cache / "covers" / "x.jpg").write_bytes(b"jpeg")

    # Переключение на новый корень происходит ДО первого обращения к СУБД.
    new_root = library.parent / "new-root"
    new_root.mkdir()
    make_book(new_root, "b.pdf")
    write_runtime_config(root=str(new_root))

    # Первый вызов connect() после переключения: миграция сюда НЕ должна попасть.
    conn = connect()
    try:
        n = conn.execute("SELECT COUNT(*) AS n FROM books").fetchone()["n"]
    finally:
        conn.close()

    # Новый слот пуст (0 карточек) — из legacy-состояния сюда ничего не переехало.
    # (Пустой library.db в слоте B создаётся самим connect(), но это не миграция:
    # данные старого корня в нём отсутствуют, n == 0 выше.)
    assert n == 0
    assert legacy.exists(), "legacy-СУБД должна остаться в cache_dir, а не уехать в чужой слот"
    assert (cache / "covers" / "x.jpg").exists(), "legacy-обложки не должны переехать"
    # В слот корня B не попали обложки старого корня.
    assert not (get_settings().slot_dir / "covers" / "x.jpg").exists()

    # Возврат на корень A и стартовая миграция отдают СУБД в слот A.
    write_runtime_config(root=str(library))
    init_state()
    conn = connect()
    try:
        n = conn.execute("SELECT COUNT(*) AS n FROM books").fetchone()["n"]
    finally:
        conn.close()
    assert n == 1, "overrides/s карточки должны были вернуться в слот корня A"


def test_edits_survive_switch_away_and_back(library: Path) -> None:
    """overrides — единственные невосстановимые данные; смена корня их не теряет."""
    # Явная петля: привилегированные ручки закрыты require_local.
    client = TestClient(app, client=("127.0.0.1", 51202))
    make_book(library, "a.pdf")
    assert client.post("/api/rescan", headers=OWN_PAGE).status_code == 200
    saved = client.post("/api/book", json={"key": "a", "title": "Правка"}, headers=OWN_PAGE)
    assert saved.json()["action"] == "saved"

    root2 = library.parent / "library2"
    root2.mkdir()
    make_book(root2, "b.pdf")
    assert (
        client.post("/api/settings", json={"root": str(root2)}, headers=OWN_PAGE).status_code == 200
    )
    assert (
        client.post("/api/settings", json={"root": str(library)}, headers=OWN_PAGE).status_code
        == 200
    )

    books = client.get("/api/books", headers=OWN_PAGE).json()
    card = next(b for b in books["books"] if b["key"] == "a")
    assert (card["title"], card["edited"]) == ("Правка", True)


def test_settings_api_preview_and_apply(library: Path) -> None:
    # Явная петля: привилегированные ручки закрыты require_local.
    client = TestClient(app, client=("127.0.0.1", 51202))
    make_book(library, "a.pdf")
    make_book(library, "b.pdf")

    preview = client.get("/api/settings/preview", params={"root": str(library)}, headers=OWN_PAGE)
    assert preview.status_code == 200
    assert preview.json()["books"] == 2

    assert (
        client.get("/api/settings/preview", params={"root": "/"}, headers=OWN_PAGE).status_code
        == 400
    )

    root2 = library.parent / "library2"
    root2.mkdir()
    make_book(root2, "c.pdf")
    applied = client.post("/api/settings", json={"root": str(root2)}, headers=OWN_PAGE)
    assert applied.status_code == 200
    assert applied.json()["added"] == 1

    books = client.get("/api/books", headers=OWN_PAGE).json()
    assert books["total"] == 1
    assert books["books"][0]["key"] == "c"
    assert client.get("/api/settings", headers=OWN_PAGE).json()["root_source"] == "config"

    # невалидный корень не трогает конфиг
    assert client.post("/api/settings", json={"root": "/nope"}, headers=OWN_PAGE).status_code == 400
    assert client.get("/api/settings", headers=OWN_PAGE).json()["root"] == str(root2)


def test_cli_config_root_matches_api_apply_root(library: Path) -> None:
    """F3: CLI и API сходятся на одном месте orchestration — service.apply_root.

    Раньше сценарий «применить корень» был продублирован в cli.app: конфиг
    писался вне замка рескана. Теперь `booklib config --root` и POST
    /api/settings держат один и тот же замок и пишут конфиг до скана.
    """
    make_book(library, "a.pdf")
    root2 = library.parent / "library2"
    root2.mkdir()
    make_book(root2, "b.pdf")

    # CLI-ветка: booklib config --root <root2> → применён корень + скан
    result = runner.invoke(cli_app, ["config", "--root", str(root2)])
    assert result.exit_code == 0
    assert "корень применён" in result.output
    slot2 = get_settings().slot_dir
    with closing(sqlite3.connect(slot2 / "library.db")) as conn:
        rows = conn.execute("SELECT key FROM books").fetchall()
    assert [r[0] for r in rows] == ["b"], "CLI-скан добавил карточку нового корня"

    # невалидный корень: отказ без записи конфига (блокер тоже общий)
    bad = runner.invoke(cli_app, ["config", "--root", "/nope"])
    assert bad.exit_code == 2
    assert get_settings().root == root2, "невалидный корень не меняет конфиг"


def test_apply_root_and_rescan_share_lock(library: Path) -> None:
    """Оба входа в скан держат один и тот же замок (service._RESCAN_LOCK).

    Запуск apply_root и rescan в конкуренции не должен дать два писателя в СУБД.
    """
    make_book(library, "a.pdf")
    root2 = library.parent / "library2"
    root2.mkdir()
    make_book(root2, "b.pdf")

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(apply_root, str(root2)), pool.submit(rescan)]
        results = [f.result() for f in futures]

    # Либо применён корень (добавлена b), либо скан старого корня — без ошибок.
    assert all(isinstance(r, dict) for r in results)


def test_legacy_partial_move_completes_on_next_start(library: Path) -> None:
    """Оборванный перенос доезжает при следующем старте.

    Ранний выход по db_path.exists() означал: если library.db переехал, а
    covers/ — нет (rename упал), обложки оставались в cache_dir навсегда и
    молча. Теперь выход считается по каждому источнику отдельно.
    Мутация: вернуть `if settings.db_path.exists(): return` — тест падает.
    """
    make_book(library, "a.pdf")
    cache = get_settings().cache_dir
    legacy_db = cache / "library.db"
    conn = connect_at(legacy_db)
    try:
        sync(conn, collect_groups())
    finally:
        conn.close()
    covers_dir = cache / "covers"
    covers_dir.mkdir()
    (covers_dir / "x.jpg").write_bytes(b"jpeg")

    # Перенос «оборвался» ровно после СУБД: covers остались в cache_dir.
    slot = get_settings().slot_dir
    slot.mkdir(parents=True, exist_ok=True)
    legacy_db.rename(slot / "library.db")
    assert covers_dir.exists()

    init_state()

    assert (slot / "covers" / "x.jpg").exists()
    assert not covers_dir.exists()


def test_legacy_migration_does_not_overwrite_populated_slot(library: Path) -> None:
    """Файл, уже лежащий в слоте, не затирается остатками в cache_dir."""
    make_book(library, "a.pdf")
    slot = get_settings().slot_dir
    conn = connect()  # населяем слот текущего корня
    try:
        sync(conn, collect_groups())
    finally:
        conn.close()

    cache = get_settings().cache_dir
    stale = cache / "library.db"
    stale.write_bytes(b"stale legacy db")

    init_state()

    assert stale.exists(), "чужой файл не должен исчезать молча"
    with closing(sqlite3.connect(slot / "library.db")) as conn2:
        assert conn2.execute("SELECT COUNT(*) FROM books").fetchone()[0] == 1
