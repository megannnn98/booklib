"""Словарь тегов и ручные назначения тегов книгам."""

from __future__ import annotations

import sqlite3
import time
from contextlib import suppress
from typing import cast

KINDS = frozenset({"topic", "technology", "person", "period", "language", "form", "custom"})
DESCRIPTION_UNSET = object()


class TagError(Exception):
    status = 400


class TagInvalid(TagError):
    status = 400


class TagNotFound(TagError):
    status = 404


class TagConflict(TagError):
    status = 409


class TagInUse(TagError):
    status = 409

    def __init__(self, count: int) -> None:
        super().__init__(f"тег используется в {count} книгах")
        self.count = count


def normalize(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise TagInvalid("пустое имя тега")
    return cleaned


def normalize_required(value: str, field: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise TagInvalid(f"пустое значение: {field}")
    return cleaned


def normalize_description(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _validate_kind(kind: str) -> str:
    cleaned = normalize_required(kind, "kind")
    if cleaned not in KINDS:
        raise TagInvalid(f"неизвестный kind: {kind}")
    return cleaned


def _begin_immediate(conn: sqlite3.Connection) -> None:
    conn.execute("BEGIN IMMEDIATE")


def _tag_row(conn: sqlite3.Connection, tag_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM tags WHERE id = ?", (tag_id,)).fetchone()


def _tag_by_name(conn: sqlite3.Connection, name: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM tags WHERE name = ?", (name,)).fetchone()


def _tag_by_alias(conn: sqlite3.Connection, alias: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT t.* FROM tags t JOIN tag_aliases a ON a.tag_id = t.id WHERE a.alias = ?",
        (alias,),
    ).fetchone()


def _ensure_name_alias_free(conn: sqlite3.Connection, tag_id: int | None, name: str) -> None:
    row = conn.execute(
        "SELECT 1 FROM tag_aliases a JOIN tags t ON t.id = a.tag_id WHERE a.alias = ?"
        + (" AND t.id != ?" if tag_id is not None else ""),
        ((name, tag_id) if tag_id is not None else (name,)),
    ).fetchone()
    if row is not None:
        raise TagConflict("имя занято алиасом другого тега")


def _ensure_alias_name_free(conn: sqlite3.Connection, tag_id: int, alias: str) -> None:
    row = conn.execute(
        "SELECT 1 FROM tags t WHERE t.name = ? AND t.id != ?",
        (alias, tag_id),
    ).fetchone()
    if row is not None:
        raise TagConflict("алиас занят именем другого тега")


def _insert_alias(conn: sqlite3.Connection, tag_id: int, alias: str) -> None:
    alias = normalize_required(alias, "alias")
    tag = _tag_row(conn, tag_id)
    if tag is None:
        raise TagNotFound(f"нет такого тега: {tag_id}")
    if alias.casefold() == tag["name"].casefold():
        raise TagConflict("алиас совпадает с именем тега")
    if _tag_by_name(conn, alias) is not None:
        raise TagConflict("алиас занят именем другого тега")
    _ensure_name_alias_free(conn, tag_id, alias)
    if _tag_by_alias(conn, alias) is not None:
        raise TagConflict("алиас уже занят")
    conn.execute("INSERT INTO tag_aliases(tag_id, alias) VALUES(?,?)", (tag_id, alias))


def _tag_payload(conn: sqlite3.Connection, tag_id: int) -> dict:
    tag = _tag_row(conn, tag_id)
    if tag is None:
        raise TagNotFound(f"нет такого тега: {tag_id}")
    aliases = [
        row["alias"]
        for row in conn.execute(
            "SELECT alias FROM tag_aliases WHERE tag_id = ? ORDER BY alias COLLATE unicode_ci",
            (tag_id,),
        ).fetchall()
    ]
    count = conn.execute(
        "SELECT COUNT(*) AS n FROM book_tags bt JOIN books b ON b.key = bt.book_key "
        "WHERE bt.tag_id = ? AND b.missing = 0",
        (tag_id,),
    ).fetchone()["n"]
    return {
        "id": tag["id"],
        "name": tag["name"],
        "kind": tag["kind"],
        "description": tag["description"],
        "created_at": tag["created_at"],
        "aliases": aliases,
        "count": count,
    }


def list_tags(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT id FROM tags ORDER BY name COLLATE unicode_ci").fetchall()
    return [_tag_payload(conn, row["id"]) for row in rows]


def create_tag(
    conn: sqlite3.Connection,
    name: str,
    kind: str = "custom",
    description: str | None = None,
) -> dict:
    name = normalize(name)
    kind = _validate_kind(kind)
    description = normalize_description(description)
    _begin_immediate(conn)
    try:
        _ensure_name_alias_free(conn, None, name)
        if _tag_by_name(conn, name) is not None:
            raise TagConflict("тег с таким именем уже существует")
        conn.execute(
            "INSERT INTO tags(name, kind, description, created_at) VALUES(?,?,?,?)",
            (name, kind, description, time.time()),
        )
        tag_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        conn.commit()
        return _tag_payload(conn, tag_id)
    except Exception:
        conn.rollback()
        raise


def update_tag(
    conn: sqlite3.Connection,
    tag_id: int,
    name: str | None,
    kind: str | None,
    description: str | None | object = DESCRIPTION_UNSET,
) -> dict:
    _begin_immediate(conn)
    try:
        tag = _tag_row(conn, tag_id)
        if tag is None:
            raise TagNotFound(f"нет такого тега: {tag_id}")
        new_name = normalize(name) if name is not None else tag["name"]
        new_kind = _validate_kind(kind) if kind is not None else tag["kind"]
        new_description = tag["description"]
        if description is not DESCRIPTION_UNSET:
            new_description = normalize_description(cast(str | None, description))
        # Переименование — вторая дверь к инварианту «алиас != имя тега»: сам
        # add_alias его держит, а _ensure_name_alias_free исключает собственный
        # тег, и без этой проверки tag.name спокойно становится своим же алиасом
        # (name и alias — UNIQUE в РАЗНЫХ таблицах, СУБД такой конфликт не видит).
        if new_name != tag["name"]:
            own_alias = conn.execute(
                "SELECT 1 FROM tag_aliases WHERE tag_id = ? AND alias = ?",
                (tag_id, new_name),
            ).fetchone()
            if own_alias is not None:
                raise TagConflict("имя совпадает с алиасом этого тега")
        _ensure_name_alias_free(conn, tag_id, new_name)
        if new_name != tag["name"] and _tag_by_name(conn, new_name) is not None:
            raise TagConflict("тег с таким именем уже существует")
        conn.execute(
            "UPDATE tags SET name = ?, kind = ?, description = ? WHERE id = ?",
            (new_name, new_kind, new_description, tag_id),
        )
        conn.commit()
        return _tag_payload(conn, tag_id)
    except Exception:
        conn.rollback()
        raise


def add_alias(conn: sqlite3.Connection, tag_id: int, alias: str) -> dict:
    _begin_immediate(conn)
    try:
        _insert_alias(conn, tag_id, alias)
        conn.commit()
        return _tag_payload(conn, tag_id)
    except Exception:
        conn.rollback()
        raise


def upsert_tag(
    conn: sqlite3.Connection,
    name: str,
    kind: str = "custom",
    description: str | None = None,
    aliases: list[str] | None = None,
) -> dict:
    """Создать тег или аккуратно дополнить уже существующий.

    Используется для миграции legacy-состояния: существующий серверный тег
    не перетирается безусловно, но отсутствующие поля и алиасы можно добавить.
    """
    name = normalize(name)
    kind = _validate_kind(kind)
    description = normalize_description(description)
    aliases = aliases or []
    _begin_immediate(conn)
    try:
        tag = _tag_by_name(conn, name)
        matched_alias = False
        if tag is None:
            tag = _tag_by_alias(conn, name)
            matched_alias = tag is not None
        if tag is None:
            conn.execute(
                "INSERT INTO tags(name, kind, description, created_at) VALUES(?,?,?,?)",
                (name, kind, description, time.time()),
            )
            tag_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
            tag = _tag_row(conn, tag_id)
        else:
            tag_id = tag["id"]
            new_kind = tag["kind"]
            new_description = tag["description"]
            if tag["kind"] == "custom" and kind != "custom":
                new_kind = kind
            if new_description is None and description is not None:
                new_description = description
            if new_kind != tag["kind"] or new_description != tag["description"]:
                conn.execute(
                    "UPDATE tags SET kind = ?, description = ? WHERE id = ?",
                    (new_kind, new_description, tag_id),
                )
        import_aliases = [
            alias for alias in aliases if alias and alias.casefold() != name.casefold()
        ]
        if matched_alias and tag is not None and name.casefold() != tag["name"].casefold():
            import_aliases = [name, *import_aliases]
        for alias in import_aliases:
            with suppress(TagConflict):
                _insert_alias(conn, tag_id, alias)
        conn.commit()
        return _tag_payload(conn, tag_id)
    except Exception:
        conn.rollback()
        raise


def remove_alias(conn: sqlite3.Connection, tag_id: int, alias: str) -> dict:
    alias = normalize_required(alias, "alias")
    _begin_immediate(conn)
    try:
        deleted = conn.execute(
            "DELETE FROM tag_aliases WHERE tag_id = ? AND alias = ?",
            (tag_id, alias),
        ).rowcount
        if deleted == 0:
            raise TagNotFound(f"нет такого алиаса: {alias}")
        conn.commit()
        return _tag_payload(conn, tag_id)
    except Exception:
        conn.rollback()
        raise


def delete_tag(conn: sqlite3.Connection, tag_id: int) -> dict:
    _begin_immediate(conn)
    try:
        tag = _tag_row(conn, tag_id)
        if tag is None:
            raise TagNotFound(f"нет такого тега: {tag_id}")
        count = conn.execute(
            "SELECT COUNT(*) AS n FROM book_tags WHERE tag_id = ?",
            (tag_id,),
        ).fetchone()["n"]
        if count:
            raise TagInUse(count)
        conn.execute("DELETE FROM tag_aliases WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        conn.commit()
        return {"deleted": tag_id}
    except Exception:
        conn.rollback()
        raise


def merge_tags(conn: sqlite3.Connection, source_id: int, target_id: int) -> dict:
    if source_id == target_id:
        raise TagInvalid("source и target должны различаться")
    _begin_immediate(conn)
    try:
        source = _tag_row(conn, source_id)
        target = _tag_row(conn, target_id)
        if source is None:
            raise TagNotFound(f"нет такого тега: {source_id}")
        if target is None:
            raise TagNotFound(f"нет такого тега: {target_id}")

        moved = conn.execute(
            "UPDATE OR IGNORE book_tags SET tag_id = ? WHERE tag_id = ?",
            (target_id, source_id),
        ).rowcount
        dropped = conn.execute(
            "DELETE FROM book_tags WHERE tag_id = ?",
            (source_id,),
        ).rowcount

        aliases_moved = 0
        skipped = 0
        for row in conn.execute(
            "SELECT alias FROM tag_aliases WHERE tag_id = ?", (source_id,)
        ).fetchall():
            alias = row["alias"]
            conflict = conn.execute(
                "SELECT 1 FROM tags WHERE name = ? AND id != ?",
                (alias, target_id),
            ).fetchone()
            if conflict is not None:
                skipped += 1
                continue
            conflict = conn.execute(
                "SELECT 1 FROM tag_aliases a JOIN tags t ON t.id = a.tag_id "
                "WHERE a.alias = ? AND t.id NOT IN (?, ?)",
                (alias, source_id, target_id),
            ).fetchone()
            if conflict is not None:
                skipped += 1
                continue
            conn.execute(
                "UPDATE tag_aliases SET tag_id = ? WHERE tag_id = ? AND alias = ?",
                (target_id, source_id, alias),
            )
            aliases_moved += 1

        if source["name"] != target["name"]:
            conflict = conn.execute(
                "SELECT 1 FROM tags WHERE name = ? AND id NOT IN (?, ?)",
                (source["name"], source_id, target_id),
            ).fetchone()
            alias_conflict = conn.execute(
                "SELECT 1 FROM tag_aliases a JOIN tags t ON t.id = a.tag_id "
                "WHERE a.alias = ? AND t.id NOT IN (?, ?)",
                (source["name"], source_id, target_id),
            ).fetchone()
            if conflict is None and alias_conflict is None:
                conn.execute(
                    "INSERT INTO tag_aliases(tag_id, alias) VALUES(?, ?)",
                    (target_id, source["name"]),
                )
            else:
                skipped += 1

        conn.execute("DELETE FROM tag_aliases WHERE tag_id = ?", (source_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (source_id,))
        conn.commit()
        return {
            "moved": moved,
            "dropped": dropped,
            "aliases_moved": aliases_moved,
            "skipped": skipped,
        }
    except Exception:
        conn.rollback()
        raise


def resolve(conn: sqlite3.Connection, names: list[str]) -> list[int]:
    ids: list[int] = []
    seen: set[int] = set()
    for name in names:
        cleaned = normalize_required(name, "tag")
        row = _tag_by_name(conn, cleaned)
        if row is None:
            row = _tag_by_alias(conn, cleaned)
        if row is None:
            raise TagNotFound(f"нет такого тега: {cleaned}")
        tag_id = row["id"]
        if tag_id not in seen:
            seen.add(tag_id)
            ids.append(tag_id)
    return ids


def replace_book_tags(conn: sqlite3.Connection, key: str, names: list[str]) -> dict:
    """Заменить manual-связи книги на указанный набор тегов.

    BEGIN/commit/rollback управляются вызывающим: эта функция предполагает
    уже открытое соединение в нужной транзакции и не начинает новую сама.
    """
    book = conn.execute("SELECT 1 FROM books WHERE key = ?", (key,)).fetchone()
    if book is None:
        raise TagNotFound(f"нет такой карточки: {key}")
    ids = resolve(conn, names)
    conn.execute(
        "DELETE FROM book_tags WHERE book_key = ? AND source = 'manual'",
        (key,),
    )
    for tag_id in ids:
        conn.execute(
            "INSERT OR IGNORE INTO book_tags(book_key, tag_id, source) VALUES(?,?, 'manual')",
            (key, tag_id),
        )
    return {"key": key, "tags": ids}


def set_book_tags(conn: sqlite3.Connection, key: str, names: list[str]) -> dict:
    _begin_immediate(conn)
    try:
        result = replace_book_tags(conn, key, names)
        conn.commit()
        return result
    except Exception:
        conn.rollback()
        raise


def manual_tag_names_for(conn: sqlite3.Connection, key: str) -> list[str]:
    rows = conn.execute(
        "SELECT t.name FROM book_tags bt JOIN tags t ON t.id = bt.tag_id "
        "WHERE bt.book_key = ? AND bt.source = 'manual' "
        "ORDER BY t.name COLLATE unicode_ci",
        (key,),
    ).fetchall()
    return [row["name"] for row in rows]


def merge_book_tags(conn: sqlite3.Connection, key: str, names: list[str]) -> dict:
    seen: set[str] = set()
    merged: list[str] = []
    for name in [*manual_tag_names_for(conn, key), *names]:
        cleaned = normalize_required(name, "tag")
        marker = cleaned.casefold()
        if marker in seen:
            continue
        seen.add(marker)
        merged.append(cleaned)
    return set_book_tags(conn, key, merged)


def tags_for(conn: sqlite3.Connection, keys: list[str]) -> dict[str, list[dict]]:
    if not keys:
        return {}
    placeholders = ",".join("?" for _ in keys)
    rows = conn.execute(
        "SELECT bt.book_key, t.id, t.name, t.kind "
        "FROM book_tags bt JOIN tags t ON t.id = bt.tag_id "
        f"WHERE bt.book_key IN ({placeholders}) "
        "ORDER BY bt.book_key, t.name COLLATE unicode_ci",
        tuple(keys),
    ).fetchall()
    result: dict[str, list[dict[str, object]]] = {key: [] for key in keys}
    for row in rows:
        result[row["book_key"]].append(
            {
                "id": row["id"],
                "name": row["name"],
                "kind": row["kind"],
            }
        )
    return result
