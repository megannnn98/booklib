"""Сканер библиотеки: обход дерева, группировка файлов в книги, инкрементальный диф.

Библиотека читается строго read-only — это активные раздачи qBittorrent,
переименование или перемещение сломает fastresume-файлы.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypedDict

from booklib.config.settings import get_settings
from booklib.meta import normalize_basename, parse_meta

BOOK_EXTS = (".pdf", ".djvu", ".djv", ".epub", ".fb2", ".rtf")
AUDIO_EXTS = (".mp3",)
FORMAT_PREFERENCE = (".pdf", ".djvu", ".djv", ".epub", ".fb2", ".rtf", ".mp3")

AUDIO_DIR_NAMES = {"audio", "аудио", "sound", "mp3"}
AUDIO_GROUP_MARKER = "__audio__"

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

# Колонки, добавленные после первого релиза схемы: (таблица, колонка, тип)
MIGRATIONS = (("books", "cover_error", "TEXT"),)


class ScanReport(TypedDict):
    """Сводка обхода: сколько файлов, сколько карточек, сколько склеено."""

    files: int
    cards: int
    books: int
    audio: int
    multi_format: int
    merged_stems: int
    by_ext: dict[str, int]


class LibraryUnavailable(RuntimeError):
    """Корень библиотеки не смонтирован или пуст — каталог трогать нельзя."""


@dataclass
class BookGroup:
    key: str
    dir: str
    basename: str
    kind: str = "book"
    files: list[Path] = field(default_factory=list)

    @property
    def sorted_files(self) -> list[Path]:
        def rank(path: Path) -> tuple[int, str]:
            ext = path.suffix.lower()
            order = FORMAT_PREFERENCE.index(ext) if ext in FORMAT_PREFERENCE else 99
            return (order, path.name)

        return sorted(self.files, key=rank)

    @property
    def formats(self) -> list[str]:
        seen: list[str] = []
        for path in self.sorted_files:
            ext = path.suffix.lower().lstrip(".")
            if ext not in seen:
                seen.append(ext)
        return seen

    @property
    def primary_file(self) -> Path:
        return self.sorted_files[0]

    @property
    def total_size(self) -> int:
        return sum(p.stat().st_size for p in self.files)

    @property
    def max_mtime(self) -> float:
        return max(p.stat().st_mtime for p in self.files)


def library_root(root: Path | None = None) -> Path:
    return root if root is not None else get_settings().root


def relative_to_root(path: Path, root: Path | None = None) -> str:
    return str(path.relative_to(library_root(root)))


def _audio_title(directory: Path, root: Path) -> str:
    name = directory.name
    if name.lower() in AUDIO_DIR_NAMES and directory != root:
        return f"{directory.parent.name} (аудио)"
    return f"{name} (аудио)"


def collect_groups(root: Path | None = None) -> dict[str, BookGroup]:
    """Обойти дерево и собрать логические книги. Только чтение."""
    root = library_root(root)
    if not root.is_dir():
        raise LibraryUnavailable(f"корень библиотеки недоступен: {root}")

    groups: dict[str, BookGroup] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        directory = Path(dirpath)
        reldir = "" if directory == root else relative_to_root(directory, root)

        for filename in sorted(filenames):
            if filename.startswith("."):
                continue
            path = directory / filename
            ext = path.suffix.lower()

            if ext in BOOK_EXTS:
                basename = normalize_basename(path.stem)
                kind = "book"
            elif ext in AUDIO_EXTS:
                basename = AUDIO_GROUP_MARKER
                kind = "audio"
            else:
                continue

            key = f"{reldir}/{basename}" if reldir else basename
            group = groups.get(key)
            if group is None:
                group = BookGroup(key=key, dir=reldir, basename=basename, kind=kind)
                groups[key] = group
            group.files.append(path)

    return groups


def group_meta(group: BookGroup, root: Path | None = None) -> tuple[str, str | None, int | None]:
    if group.kind == "audio":
        root = library_root(root)
        directory = root / group.dir if group.dir else root
        return _audio_title(directory, root), None, None
    return parse_meta(group.basename)


def _apply_migrations(conn: sqlite3.Connection) -> None:
    for table, column, column_type in MIGRATIONS:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")
    conn.commit()


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    db_path = db_path if db_path is not None else get_settings().db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    _apply_migrations(conn)
    return conn


def sync(
    conn: sqlite3.Connection,
    groups: dict[str, BookGroup],
    root: Path | None = None,
) -> dict[str, int]:
    """Записать диф в СУБД. Пользовательские правки живут в overrides и не трогаются."""
    root = library_root(root)
    known = conn.execute("SELECT COUNT(*) AS n FROM books WHERE missing = 0").fetchone()["n"]
    if not groups and known:
        raise LibraryUnavailable(
            f"найдено 0 книг при {known} в каталоге — скан прерван, каталог не тронут"
        )

    now = time.time()
    stats = {"added": 0, "updated": 0, "unchanged": 0, "missing": 0, "restored": 0}
    rows = {row["key"]: row for row in conn.execute("SELECT * FROM books")}

    for key, group in groups.items():
        title, author, year = group_meta(group, root)
        formats_json = json.dumps(group.formats, ensure_ascii=False)
        files_json = json.dumps(
            [relative_to_root(p, root) for p in group.sorted_files], ensure_ascii=False
        )
        primary = relative_to_root(group.primary_file, root)
        size, mtime = group.total_size, group.max_mtime
        row = rows.get(key)

        if row is None:
            conn.execute(
                """INSERT INTO books(key, dir, basename, title, author, year, kind,
                                     formats_json, files_json, primary_file, size, mtime,
                                     added_at, seen_at, missing)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)""",
                (
                    key,
                    group.dir,
                    group.basename,
                    title,
                    author,
                    year,
                    group.kind,
                    formats_json,
                    files_json,
                    primary,
                    size,
                    mtime,
                    now,
                    now,
                ),
            )
            stats["added"] += 1
            continue

        changed = (
            row["size"] != size
            or abs(row["mtime"] - mtime) > 1e-6
            or row["formats_json"] != formats_json
            or row["files_json"] != files_json
            or row["primary_file"] != primary
        )
        if changed:
            conn.execute(
                """UPDATE books SET formats_json=?, files_json=?, primary_file=?, size=?,
                                    mtime=?, has_cover=0, seen_at=?, missing=0 WHERE key=?""",
                (formats_json, files_json, primary, size, mtime, now, key),
            )
            stats["updated"] += 1
        else:
            conn.execute("UPDATE books SET seen_at=?, missing=0 WHERE key=?", (now, key))
            stats["unchanged"] += 1
        if row["missing"]:
            stats["restored"] += 1

    placeholders = ",".join("?" * len(groups)) if groups else "''"
    cursor = conn.execute(
        f"UPDATE books SET missing=1 WHERE missing=0 AND key NOT IN ({placeholders})",
        tuple(groups),
    )
    stats["missing"] = cursor.rowcount
    conn.execute(
        "INSERT INTO state(k, v) VALUES('last_scan', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        (str(now),),
    )
    conn.commit()
    return stats


def stats_report(groups: dict[str, BookGroup]) -> ScanReport:
    """Сводка по результатам обхода — для CLI и тестов."""
    by_ext: dict[str, int] = {}
    files_total = 0
    multi_format = 0
    merged_stems = 0

    for group in groups.values():
        files_total += len(group.files)
        for path in group.files:
            ext = path.suffix.lower().lstrip(".")
            by_ext[ext] = by_ext.get(ext, 0) + 1
        if len(group.formats) > 1:
            multi_format += 1
        if len({p.stem for p in group.files}) > 1:
            merged_stems += 1

    return {
        "files": files_total,
        "cards": len(groups),
        "books": sum(1 for g in groups.values() if g.kind == "book"),
        "audio": sum(1 for g in groups.values() if g.kind == "audio"),
        "multi_format": multi_format,
        "merged_stems": merged_stems,
        "by_ext": dict(sorted(by_ext.items())),
    }
