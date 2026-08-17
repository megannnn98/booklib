"""Разбор имён файлов: нормализация basename, вытаскивание названия/автора/года.

Источник правды для названий — taxonomy.json (шаг 3). Здесь только эвристики,
которыми наполняется каталог для книг, которых в taxonomy ещё нет.
"""

from __future__ import annotations

import re

# Варианты вёрстки одного и того же текста: "... - 2019.a4.pdf" / "... - 2019.a6.pdf"
LAYOUT_VARIANT_RE = re.compile(r"\.a[3-6]$", re.IGNORECASE)

# Суффиксы машинно-сгенерированных имён: "_p117_1", "_v3", "_p1083_v3"
GENERATED_SUFFIX_RE = re.compile(r"_(?:p\d+(?:_\d+)?|v\d+)$", re.IGNORECASE)

YEAR_RE = re.compile(r"(?<!\d)(1[5-9]\d{2}|20[0-4]\d)(?!\d)")

# Инициалы вида "Торчинов Е.А." или "Brown L."
INITIALS_RE = re.compile(r"[А-ЯЁA-Z]\.")

MIN_STEM_AFTER_STRIP = 8
MAX_TITLE_LEN = 120


def normalize_basename(stem: str) -> str:
    """Свести имя файла к ключу книги.

    Снимает суффиксы вариантов вёрстки (.a4/.a6) и машинные хвосты (_p117_1, _v3),
    чтобы разные представления одного текста схлопнулись в одну карточку.
    """
    base = stem
    while (match := LAYOUT_VARIANT_RE.search(base)) is not None:
        base = base[: match.start()]
    while (match := GENERATED_SUFFIX_RE.search(base)) is not None:
        stripped = base[: match.start()]
        if len(stripped) < MIN_STEM_AFTER_STRIP:
            break
        base = stripped
    return base.strip()


def _looks_like_author(chunk: str) -> bool:
    chunk = chunk.strip()
    if not chunk or chunk[0].isdigit():
        return False
    words = chunk.split()
    if len(words) > 5:
        return False
    if INITIALS_RE.search(chunk):
        return True
    return len(words) <= 3 and chunk[0].isupper()


def _humanize(raw: str) -> str:
    text = raw
    # машинные имена: подчёркиваний больше, чем пробелов
    if text.count("_") > text.count(" "):
        text = text.replace("_", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip(" .-—")


def parse_meta(basename: str) -> tuple[str, str | None, int | None]:
    """Вернуть (title, author, year) из нормализованного basename."""
    text = _humanize(basename)

    years = YEAR_RE.findall(text)
    year = int(years[-1]) if years else None

    author: str | None = None
    title = text
    if " - " in text:
        head, rest = text.split(" - ", 1)
        if _looks_like_author(head) and rest.strip():
            author, title = head.strip(), rest.strip()

    if year is not None:
        title = re.sub(rf"[\s\-—(\[]*{year}[\s)\]]*$", "", title)
    title = re.sub(r"[\s.\-—]+$", "", title) or text
    if len(title) > MAX_TITLE_LEN:
        title = title[: MAX_TITLE_LEN - 1].rstrip() + "…"
    return title, author, year
