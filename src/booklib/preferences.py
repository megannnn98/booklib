"""Пользовательские настройки, общие для всех клиентов."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping
from typing import Any

PREFERENCES_STATE_KEY = "ui_preferences"
DEFAULT_PREFERENCES: dict[str, Any] = {
    "sort": "title",
    "section": "*",
    "tags": [],
}


def _normalize_tags(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        if not cleaned:
            continue
        marker = cleaned.casefold()
        if marker in seen:
            continue
        seen.add(marker)
        result.append(cleaned)
    return result


def _load_raw_preferences(conn: sqlite3.Connection) -> dict[str, Any]:
    row = conn.execute("SELECT v FROM state WHERE k = ?", (PREFERENCES_STATE_KEY,)).fetchone()
    if row is None:
        return {}
    try:
        loaded = json.loads(row["v"])
    except (TypeError, json.JSONDecodeError):
        return {}
    if not isinstance(loaded, dict):
        return {}
    return loaded


def load_preferences(conn: sqlite3.Connection) -> dict[str, Any]:
    raw = _load_raw_preferences(conn)
    preferences: dict[str, Any] = dict(DEFAULT_PREFERENCES)

    sort = raw.get("sort")
    if isinstance(sort, str) and sort.strip():
        preferences["sort"] = sort.strip()

    section = raw.get("section")
    if isinstance(section, str) and section.strip():
        preferences["section"] = section.strip()

    tags = raw.get("tags")
    if isinstance(tags, list):
        preferences["tags"] = _normalize_tags(tags)

    return preferences


def update_preferences(
    conn: sqlite3.Connection,
    *,
    sort: str | None = None,
    section: str | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    current = load_preferences(conn)
    if sort is not None:
        current["sort"] = sort
    if section is not None:
        current["section"] = section.strip() or "*"
    if tags is not None:
        current["tags"] = _normalize_tags(tags)

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            "INSERT INTO state(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            (PREFERENCES_STATE_KEY, json.dumps(current, ensure_ascii=False)),
        )
        conn.commit()
        return current
    except Exception:
        conn.rollback()
        raise


def merge_preferences(
    conn: sqlite3.Connection,
    payload: Mapping[str, Any] | None,
) -> dict[str, Any]:
    if not payload:
        return load_preferences(conn)

    sort = payload.get("sort")
    if sort is not None and not isinstance(sort, str):
        sort = None

    section = payload.get("section")
    if section is not None and not isinstance(section, str):
        section = None

    tags = payload.get("tags")
    if tags is not None and not isinstance(tags, list):
        tags = None

    return update_preferences(conn, sort=sort, section=section, tags=tags)
