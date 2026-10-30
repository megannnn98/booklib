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


def _rebuild(conn: sqlite3.Connection, rules: list[TagRule]) -> dict[str, int]:
    """Тело пересборки без управления транзакцией: его держат apply/preview."""
    stats = {"rules": len(rules), "tags_created": 0, "links": 0, "books": 0, "tagged": 0}
    tag_ids: dict[str, int] = {}
    for rule in rules:
        tag_id, created = _ensure_tag(conn, rule)
        tag_ids[rule.tag] = tag_id
        stats["tags_created"] += int(created)

    # Карточки в статусе missing тоже обрабатываются: пропуск оставил бы у
    # них auto-связи от прошлого прогона, а свежие правила к ним бы не
    # применились — выдача зависела бы от того, был ли диск примонтирован.
    conn.execute("DELETE FROM book_tags WHERE source = 'auto'")
    # Ручная правка названия/автора главнее taxonomy, как и в выдаче: правят
    # ровно те карточки, у которых имя файла нечитаемо и правилам не за что
    # зацепиться.
    rows = conn.execute(
        "SELECT b.key, COALESCE(o.title, b.title) AS title, "
        "COALESCE(o.author, b.author) AS author "
        "FROM books b LEFT JOIN overrides o ON o.key = b.key"
    ).fetchall()
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
    return stats


def apply(conn: sqlite3.Connection) -> dict[str, int]:
    """Пересобрать auto-связи всего каталога. Идемпотентно.

    Одна транзакция на весь проход: половина расставленных тегов после обрыва
    хуже, чем ни одного — по такой выдаче не видно, что правило не отработало.
    """
    rules = load_rules()
    if not rules:
        return {"rules": 0, "tags_created": 0, "links": 0, "books": 0, "tagged": 0}

    conn.execute("BEGIN IMMEDIATE")
    try:
        stats = _rebuild(conn, rules)
        conn.commit()
        return stats
    except Exception:
        conn.rollback()
        raise


def preview(conn: sqlite3.Connection) -> dict:
    """Покрытие, которое дали бы текущие правила, без записи в СУБД.

    Тот же _rebuild, что и в apply, внутри транзакции с откатом: статистика
    считается кодом записи, а не его копией, которая разъехалась бы с ним.
    """
    rules = load_rules()
    conn.execute("BEGIN IMMEDIATE")
    try:
        _rebuild(conn, rules)
        return coverage(conn)
    finally:
        conn.rollback()


def coverage(conn: sqlite3.Connection) -> dict:
    """Покрытие живых карточек тегами любого источника: сколько размечено,
    частоты тегов и неразмеченные по разделам. Только чтение."""
    books = conn.execute("SELECT COUNT(*) AS n FROM books WHERE missing = 0").fetchone()["n"]
    tagged = conn.execute(
        "SELECT COUNT(DISTINCT bt.book_key) AS n FROM book_tags bt "
        "JOIN books b ON b.key = bt.book_key WHERE b.missing = 0"
    ).fetchone()["n"]
    tag_rows = conn.execute(
        "SELECT t.name, COUNT(DISTINCT bt.book_key) AS n FROM tags t "
        "JOIN book_tags bt ON bt.tag_id = t.id "
        "JOIN books b ON b.key = bt.book_key WHERE b.missing = 0 "
        "GROUP BY t.id ORDER BY n DESC, t.name"
    ).fetchall()
    untagged_rows = conn.execute(
        "SELECT COALESCE(o.section, b.section) AS section, COUNT(*) AS n "
        "FROM books b LEFT JOIN overrides o ON o.key = b.key "
        "WHERE b.missing = 0 AND NOT EXISTS "
        "(SELECT 1 FROM book_tags bt WHERE bt.book_key = b.key) "
        "GROUP BY 1 ORDER BY n DESC"
    ).fetchall()
    return {
        "books": books,
        "tagged": tagged,
        "tags": [(row["name"], row["n"]) for row in tag_rows],
        "untagged_by_section": [(row["section"], row["n"]) for row in untagged_rows],
    }
