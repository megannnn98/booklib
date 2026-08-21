"""Импорт legacy-состояния в серверную БД."""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping
from typing import Any

from booklib import preferences, tags


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _string_list(value: Any) -> list[str] | None:
    if not isinstance(value, list):
        return None
    result: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        cleaned = item.strip()
        if cleaned:
            result.append(cleaned)
    return result


def import_legacy_state(conn: sqlite3.Connection, payload: Mapping[str, Any]) -> dict[str, int]:
    """Слить legacy payload с серверным состоянием без дубликатов."""
    summary = {
        "preferences": 0,
        "tags": 0,
        "book_tags": 0,
    }

    before_preferences = preferences.load_preferences(conn)
    preferences.merge_preferences(conn, payload.get("preferences"))
    after_preferences = preferences.load_preferences(conn)
    summary["preferences"] = int(before_preferences != after_preferences)

    for raw in payload.get("tags") or []:
        if not isinstance(raw, Mapping):
            continue
        name = _text(raw.get("name"))
        if name is None:
            continue
        kind = _text(raw.get("kind")) or "custom"
        description = raw.get("description")
        if description is not None and not isinstance(description, str):
            description = None
        aliases = _string_list(raw.get("aliases")) or []
        tags.upsert_tag(conn, name, kind, description, aliases)
        summary["tags"] += 1

    for raw in payload.get("books") or payload.get("book_tags") or []:
        if not isinstance(raw, Mapping):
            continue
        key = _text(raw.get("key")) or _text(raw.get("book_key"))
        if key is None:
            continue
        names = _string_list(raw.get("tags"))
        if names is None:
            continue
        tags.merge_book_tags(conn, key, names)
        summary["book_tags"] += 1

    return summary
