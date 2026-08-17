"""Соединение с SQLite: схема, миграции, WAL. Изменяемое состояние живёт здесь."""

from __future__ import annotations

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


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    db_path = db_path if db_path is not None else get_settings().db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # timeout задаётся при открытии, а НЕ отдельным PRAGMA после: переключение
    # журнала в WAL требует эксклюзивной блокировки, и при одновременном открытии
    # свежей СУБД несколькими потоками сам этот PRAGMA падал с "database is locked".
    conn = sqlite3.connect(db_path, timeout=BUSY_TIMEOUT_S)
    conn.row_factory = sqlite3.Row
    _enable_wal(conn)
    conn.executescript(SCHEMA)
    _apply_migrations(conn)
    return conn
