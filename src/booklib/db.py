"""Соединение с SQLite: схема, миграции, WAL. Изменяемое состояние живёт здесь."""

from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path

from booklib.config.settings import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS books(
    key            TEXT PRIMARY KEY,
    dir            TEXT NOT NULL,
    basename       TEXT NOT NULL,
    title          TEXT NOT NULL,
    author         TEXT,
    year           INTEGER,
    section        TEXT,
    section_source TEXT,
    kind           TEXT NOT NULL DEFAULT 'book',
    formats_json   TEXT NOT NULL,
    files_json     TEXT NOT NULL,
    primary_file   TEXT NOT NULL,
    size           INTEGER NOT NULL,
    mtime          REAL NOT NULL,
    has_cover      INTEGER NOT NULL DEFAULT 0,
    cover_error    TEXT,
    added_at       REAL NOT NULL,
    seen_at        REAL NOT NULL,
    missing        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS overrides(
    key        TEXT PRIMARY KEY,
    title      TEXT,
    author     TEXT,
    section    TEXT,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS state(
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS books_section ON books(section);
CREATE INDEX IF NOT EXISTS books_missing ON books(missing);
"""

# Сколько ждать освобождения СУБД, прежде чем отдать "database is locked"
BUSY_TIMEOUT_S = 15.0
WAL_RETRIES = 10
WAL_RETRY_DELAY_S = 0.05

# Колонки, добавленные после первого релиза схемы: (таблица, колонка, тип)
MIGRATIONS = (("books", "cover_error", "TEXT"),)


def _apply_migrations(conn: sqlite3.Connection) -> None:
    for table, column, column_type in MIGRATIONS:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")
            except sqlite3.OperationalError as exc:
                # PRAGMA + ALTER не атомарны: другое соединение могло успеть между ними
                if "duplicate column" not in str(exc):
                    raise
    conn.commit()


def _enable_wal(conn: sqlite3.Connection) -> None:
    """Перевести СУБД в WAL, чтобы рескан не блокировал читателей витрины.

    Смена журнала требует эксклюзивной блокировки, и SQLite возвращает на ней BUSY
    НЕ вызывая busy-handler — то есть timeout соединения здесь не работает. Поэтому
    короткий ретрай. Режим хранится в самом файле: достаточно, чтобы его выставило
    одно соединение, остальные получат готовый "wal". Если не удалось совсем —
    это не фатально, журнал остаётся прежним, корректность не страдает.
    """
    for _ in range(WAL_RETRIES):
        try:
            mode = conn.execute("PRAGMA journal_mode=WAL").fetchone()[0]
        except sqlite3.OperationalError:
            mode = ""
        if str(mode).lower() == "wal":
            return
        time.sleep(WAL_RETRY_DELAY_S)


def migrate_legacy_state() -> None:
    """Одноразовый перенос cache_dir/library.db → слот текущего корня.

    До слотов состояния всё изменяемое лежало прямо в cache_dir. Без переноса
    после обновления 353 карточки и накопленные правки overrides «исчезли» бы
    (в слоте создалась бы пустая СУБД). os.rename — тот же ФС, атомарно.

    Идемпотентно по КАЖДОМУ источнику, а не по факту «СУБД уже в слоте»: если
    перенос оборвался на середине (library.db переехал, covers/ — нет), ранний
    выход по db_path.exists() оставил бы covers в cache_dir навсегда и молча.
    Существующий файл в слоте не затирается — возврат на прежний корень
    попадает в населённый слот, трогать его не нужно.

    Вызывается ТОЛЬКО из init_state() на старте процесса, пока активен корень
    «до переключения»: миграция из connect() привязала бы legacy-состояние к
    корню, выбранному в момент первого запроса, и команда
    `booklib config --root /new` сразу после обновления увезла бы overrides
    старого корня в слот нового.
    """
    settings = get_settings()
    # WAL/SHM прикладываются к своей СУБД: без них данные из журнала пропадут.
    sources = (
        settings.cache_dir / "library.db",
        settings.cache_dir / "library.db-wal",
        settings.cache_dir / "library.db-shm",
        settings.cache_dir / "covers",
    )
    remaining = [source for source in sources if source.exists()]
    if not remaining:
        return

    slot = settings.slot_dir
    slot.mkdir(parents=True, exist_ok=True)
    for source in remaining:
        target = slot / source.name
        if target.exists():
            # Слот уже населён этим файлом: либо перенос состоялся раньше, либо
            # мы вернулись на прежний корень. Затирать нельзя, пропускаем.
            continue
        try:
            os.rename(source, target)
        except OSError as exc:
            raise RuntimeError(
                f"не удалось перенести {source.name} в слот состояния {slot}: {exc}"
            ) from exc


def init_slot_marker() -> None:
    """root.txt в слоте текущего корня — литеральный путь, чтобы слот читался глазами.

    Отдельно от init_state(), потому что смена корня (service.apply_root) пишет
    маркер НОВОГО слота, но legacy-миграцию при этом выполнять нельзя (см.
    docstring migrate_legacy_state). Существующий маркер не перезаписывается:
    возврат на прежний корень не должен врать о том, когда слот создан.
    """
    settings = get_settings()
    marker = settings.slot_dir / "root.txt"
    marker.parent.mkdir(parents=True, exist_ok=True)
    if not marker.exists():
        marker.write_text(str(settings.root), encoding="utf-8")


def init_state() -> None:
    """Одноразовая подготовка слота состояния на старте процесса.

    Вызывается из Typer-callback CLI и lifespan FastAPI, пока активный корень
    ещё «до переключения»: миграция legacy и маркер попадают в слот именно того
    корня, которому состояние принадлежит. Идемпотентно — повторные вызовы не
    переносят ничего и не трогают существующий маркер.

    Известный остаток: legacy-раскладка не содержала root.txt, поэтому корень,
    которому принадлежит старая СУБД, в принципе неизвестен. Если config.json
    уже указывает на другой корень к моменту ПЕРВОГО старта новой версии
    (пользователь успел сменить корень на промежуточной версии, а скан
    оборвался до connect()), состояние привяжется к нему. Атрибуция здесь
    невозможна — это предел, а не дефект реализации.
    """
    migrate_legacy_state()
    init_slot_marker()


def _unicode_ci(left: str, right: str) -> int:
    """Регистронезависимая коллация по casefold: 'абрикос' == 'Абрикос'."""
    return (left.casefold() > right.casefold()) - (left.casefold() < right.casefold())


def connect_at(db_path: Path) -> sqlite3.Connection:
    """Соединение с конкретным файлом СУБД: тесты и разбор legacy-состояния.

    Никаких побочных эффектов на read-path: миграция legacy и root.txt готовятся
    один раз на старте процесса в init_state(), а не на каждом соединении.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # timeout задаётся при открытии, а НЕ отдельным PRAGMA после: переключение
    # журнала в WAL требует эксклюзивной блокировки, и при одновременном открытии
    # свежей СУБД несколькими потоками сам этот PRAGMA падал с "database is locked".
    conn = sqlite3.connect(db_path, timeout=BUSY_TIMEOUT_S)
    conn.row_factory = sqlite3.Row
    # LOWER() и COLLATE NOCASE в SQLite — ASCII-only. Регистрируем на соединении,
    # а не в api-слое: иначе SQL с pylower/unicode_ci был бы корректен лишь на
    # «своих» соединениях (как раньше у бесплатного wrapper'а db()), и это никак
    # не видно в месте использования запроса.
    conn.create_function("pylower", 1, lambda value: value.lower() if value else "")
    conn.create_collation("unicode_ci", _unicode_ci)
    _enable_wal(conn)
    conn.executescript(SCHEMA)
    _apply_migrations(conn)
    return conn


def connect() -> sqlite3.Connection:
    """Соединение со слотом текущего корня — единственный вариант в продакшне."""
    return connect_at(get_settings().db_path)
