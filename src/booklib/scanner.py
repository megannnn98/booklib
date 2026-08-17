"""Инкрементальная синхронизация каталога с результатами обхода библиотеки.

Пользовательские правки живут в таблице `overrides` и здесь не трогаются,
поэтому таксономию можно перегенерировать сколько угодно раз.
"""

from __future__ import annotations

import json
import sqlite3
import time

from booklib.errors import LibraryUnavailable
from booklib.grouping import BookGroup
from booklib.paths import relative_to_root


def sync(
    conn: sqlite3.Connection,
    groups: dict[str, BookGroup],
) -> dict[str, int]:
    """Записать диф в СУБД. Пользовательские правки живут в overrides и не трогаются."""
    known = conn.execute("SELECT COUNT(*) AS n FROM books WHERE missing = 0").fetchone()["n"]
    if not groups and known:
        raise LibraryUnavailable(
            f"найдено 0 книг при {known} в каталоге — скан прерван, каталог не тронут"
        )

    now = time.time()
    stats = {"added": 0, "updated": 0, "unchanged": 0, "missing": 0, "restored": 0}
    rows = {row["key"]: row for row in conn.execute("SELECT * FROM books")}

    for key, group in groups.items():
        title, author, year = group.title, group.author, group.year
        formats_json = json.dumps(group.formats, ensure_ascii=False)
        files_json = json.dumps([relative_to_root(p) for p in group.files], ensure_ascii=False)
        primary = relative_to_root(group.primary_file)
        size, mtime = group.size_mtime
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
                                    mtime=?, has_cover=0, cover_error=NULL, seen_at=?,
                                    missing=0 WHERE key=?""",
                (formats_json, files_json, primary, size, mtime, now, key),
            )
            stats["updated"] += 1
        else:
            conn.execute("UPDATE books SET seen_at=?, missing=0 WHERE key=?", (now, key))
            stats["unchanged"] += 1
        if row["missing"]:
            stats["restored"] += 1

    # По метке времени, а не `key NOT IN (?,?,...)`: там был один плейсхолдер на
    # карточку, и на ~33 тыс. книг скан упирался в SQLITE_MAX_VARIABLE_NUMBER (32766).
    # Все найденные карточки получили seen_at = now выше, у пропавших метка старее.
    cursor = conn.execute(
        "UPDATE books SET missing=1 WHERE missing=0 AND seen_at < ?",
        (now,),
    )
    stats["missing"] = cursor.rowcount
    conn.execute(
        "INSERT INTO state(k, v) VALUES('last_scan', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        (str(now),),
    )
    conn.commit()
    return stats
