"""Автоматическая расстановка тегов по правилам `tag_rules.json`.

Вторая половина тегов: словарь и ручные назначения живут в `tags.py`, здесь —
только связи с `source = 'auto'`. Разделение источников жёсткое в обе стороны:
`tags.replace_book_tags` удаляет исключительно `manual`, а `apply()` ниже —
исключительно `auto`. Поэтому рескан не сносит ручную правку, а ручная правка
не отменяет правило (снять авто-тег можно только правкой самого файла правил).

В отличие от разделов (`taxonomy.py`) срабатывают ВСЕ подходящие правила, а не
первое: у карточки один раздел, но сколько угодно тегов.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from booklib import tags, taxonomy
from booklib.config.settings import get_settings


@dataclass(frozen=True)
class TagRule:
    tag: str
    kind: str
    pattern: re.Pattern[str]


def load_rules(path: Path | None = None) -> list[TagRule]:
    path = path if path is not None else get_settings().tag_rules_path
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [
        TagRule(
            tag=tags.normalize(item["tag"]),
            kind=item.get("kind", "custom"),
            pattern=re.compile(item["pattern"], re.IGNORECASE),
        )
        for item in data.get("rules", [])
    ]


def match_text(key: str, title: str | None = None, author: str | None = None) -> str:
    """Текст, по которому работают правила: имя файла + название + автор.

    Папка игнорируется по той же причине, что и в разделах (см.
    `taxonomy.match_text`): в `programming-embedded/` лежит анархистская
    литература, и слово из пути утащило бы туда всю папку.

    Название и автор добавлены сверх имени файла, потому что `taxonomy.json`
    перекрывает их руками: там нормальная кириллица, которой в именах вроде
    `01-VozvratnyePosledovatel'nosti` просто нет.
    """
    parts = [taxonomy.match_text(key)]
    parts.extend(value for value in (title, author) if value)
    return " ".join(parts)


def _ensure_tag(conn: sqlite3.Connection, rule: TagRule) -> tuple[int, bool]:
    """id тега правила, создавая его при первом срабатывании. (id, создан ли).

    Имя правила ищется и среди алиасов — ровно как в `tags.resolve`: если
    пользователь уже завёл тег «Линукс» с алиасом «Linux», правило должно
    попасть в существующий тег, а не упасть на UNIQUE-ограничении алиаса.
    Транзакцией управляет вызывающий: `create_tag` здесь звать нельзя, она
    открывает свою.
    """
    row = conn.execute("SELECT id FROM tags WHERE name = ?", (rule.tag,)).fetchone()
    if row is not None:
        return row["id"], False
    row = conn.execute(
        "SELECT t.id FROM tags t JOIN tag_aliases a ON a.tag_id = t.id WHERE a.alias = ?",
        (rule.tag,),
    ).fetchone()
    if row is not None:
        return row["id"], False
    kind = rule.kind if rule.kind in tags.KINDS else "custom"
    conn.execute(
        "INSERT INTO tags(name, kind, description, created_at) VALUES(?,?,?,?)",
        (rule.tag, kind, "автотег из tag_rules.json", time.time()),
    )
    return conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"], True


def apply(conn: sqlite3.Connection) -> dict[str, int]:
    """Пересобрать auto-связи всего каталога. Идемпотентно.

    Одна транзакция на весь проход: половина расставленных тегов после обрыва
    хуже, чем ни одного — по такой выдаче не видно, что правило не отработало.
    """
    rules = load_rules()
    stats = {"rules": len(rules), "tags_created": 0, "links": 0, "books": 0, "tagged": 0}
    if not rules:
        return stats

    conn.execute("BEGIN IMMEDIATE")
    try:
        tag_ids: dict[str, int] = {}
        for rule in rules:
            tag_id, created = _ensure_tag(conn, rule)
            tag_ids[rule.tag] = tag_id
            stats["tags_created"] += int(created)

        # Карточки в статусе missing тоже обрабатываются: пропуск оставил бы у
        # них auto-связи от прошлого прогона, а свежие правила к ним бы не
        # применились — выдача зависела бы от того, был ли диск примонтирован.
        conn.execute("DELETE FROM book_tags WHERE source = 'auto'")
        rows = conn.execute("SELECT key, title, author FROM books").fetchall()
        for row in rows:
            stats["books"] += 1
            text = match_text(row["key"], row["title"], row["author"])
            matched = False
            for rule in rules:
                if not rule.pattern.search(text):
                    continue
                matched = True
                # OR IGNORE, а не проверка наличия: строка (book_key, tag_id)
                # может уже существовать как manual, и она главнее — ручное
                # назначение не должно молча превратиться в авто.
                conn.execute(
                    "INSERT OR IGNORE INTO book_tags(book_key, tag_id, source) VALUES(?,?, 'auto')",
                    (row["key"], tag_ids[rule.tag]),
                )
                stats["links"] += conn.execute("SELECT changes() AS n").fetchone()["n"]
            stats["tagged"] += int(matched)
        conn.commit()
        return stats
    except Exception:
        conn.rollback()
        raise
