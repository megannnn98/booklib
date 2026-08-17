#!/usr/bin/env python3
"""Применение разделов к каталогу.

Приоритет источников:
  1. overrides  — правки из UI (шаг 6), выше всего, здесь не трогаются;
  2. taxonomy.json — разовая ручная раскладка всей библиотеки;
  3. rules.json — regex-правила для книг, появившихся после раскладки;
  4. default    — раздел «Новое».

Название и автор из taxonomy.json перекрывают то, что сканер вытащил из имени файла.
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

from booklib.config.settings import get_settings
from booklib.grouping import Kind

FALLBACK_SECTION = "Новое"
AUDIO_SECTION = "Аудио"


def load_taxonomy(path: Path | None = None) -> tuple[list[str], dict[str, dict]]:
    path = path if path is not None else get_settings().taxonomy_path
    if not path.exists():
        return [], {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("sections", []), data.get("books", {})


def load_rules(path: Path | None = None) -> tuple[list[tuple[re.Pattern[str], str]], str]:
    path = path if path is not None else get_settings().rules_path
    if not path.exists():
        return [], FALLBACK_SECTION
    data = json.loads(path.read_text(encoding="utf-8"))
    compiled = [
        (re.compile(item["pattern"], re.IGNORECASE), item["section"])
        for item in data.get("rules", [])
    ]
    return compiled, data.get("default", FALLBACK_SECTION)


def apply(conn: sqlite3.Connection) -> dict[str, int]:
    _, books = load_taxonomy()
    rules, default_section = load_rules()
    stats = {"taxonomy": 0, "rules": 0, "default": 0, "audio": 0}

    rows = conn.execute("SELECT key, kind, title, author FROM books WHERE missing = 0").fetchall()
    for row in rows:
        key = row["key"]
        entry = books.get(key)

        if entry is not None:
            section, source = entry["section"], "taxonomy"
            stats["taxonomy"] += 1
            title = entry.get("title", row["title"])
            author = entry.get("author", row["author"])
        elif row["kind"] == Kind.AUDIO:
            section, source = AUDIO_SECTION, "kind"
            stats["audio"] += 1
            title, author = row["title"], row["author"]
        else:
            section, source = default_section, "default"
            text = match_text(key)
            for pattern, candidate in rules:
                if pattern.search(text):
                    section, source = candidate, "rules"
                    break
            stats["rules" if source == "rules" else "default"] += 1
            title, author = row["title"], row["author"]

        conn.execute(
            "UPDATE books SET section = ?, section_source = ?, title = ?, author = ? WHERE key = ?",
            (section, source, title, author, key),
        )

    conn.commit()
    return stats


def match_text(key: str) -> str:
    """Текст, по которому работают правила: только имя файла, разделители → пробелы.

    Папку намеренно игнорируем: физическая раскладка ненадёжна (в programming-embedded
    лежит анархистская литература), а само слово "embedded" в пути утащило бы туда
    вообще все файлы этой папки.
    """
    basename = key.rsplit("/", 1)[-1]
    return re.sub(r"[_\-.]+", " ", basename)


def classify_new(key: str, kind: Kind = Kind.BOOK) -> tuple[str, str]:
    """Раздел для карточки, которой нет в taxonomy.json (используется и в тестах)."""
    if kind == Kind.AUDIO:
        return AUDIO_SECTION, "kind"
    rules, default_section = load_rules()
    text = match_text(key)
    for pattern, section in rules:
        if pattern.search(text):
            return section, "rules"
    return default_section, "default"
