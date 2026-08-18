"""Валидация и предпросмотр нового корня библиотеки (из UI или CLI).

Полный обход (collect_groups) для предпросмотра не используется: он строит
карточки и делает stat на каждый файл, а тут нужен только счётчик книг/аудио
с ранним выходом по бюджету.
"""

from __future__ import annotations

import os
from pathlib import Path

from booklib.config.settings import get_settings
from booklib.grouping import AUDIO_EXTS, BOOK_EXTS

# Каталоги монтирования и домашний: сами по себе корнем быть не могут
# (обход уйдёт в минуты или затянет в кэш booklib), но библиотека почти всегда
# лежит ВНУТРИ них — запрещать поддеревья нельзя.
DENY_EXACT = ("/", "/home", "/media", "/mnt", "/run", "/run/media")

# Системные деревья: бессмысленны как библиотека целиком и на любой глубине.
DENY_TREE = ("/usr", "/var", "/etc", "/proc", "/sys", "/dev", "/boot")


class InvalidRoot(ValueError):
    """Корень не годится — с человекочитаемой причиной."""


def _deny_exact() -> list[Path]:
    # $HOME вычисляется динамически — он свой у каждого. Сам $HOME запрещён,
    # но ~/Books (умолчание из настроек) — законный корень.
    return [Path(path) for path in (*DENY_EXACT, str(Path.home()))]


def _deny_tree() -> list[Path]:
    return [Path(path) for path in DENY_TREE]


def _deny_reason(candidate: Path) -> str | None:
    """Причина отказа по форме пути (без обращения к диску), None — путь допустим."""
    for path in _deny_exact():
        if candidate == path:
            return f"системный путь не подходит как корень библиотеки: {candidate}"
    for path in _deny_tree():
        if candidate.is_relative_to(path):
            return f"системный путь не подходит как корень библиотеки: {candidate}"
    return None


def validate_root(value: str) -> Path:
    """Разобрать, нормализовать и проверить корень. Возвращает resolved Path."""
    if not value.strip():
        raise InvalidRoot("путь не указан")
    candidate = Path(value).expanduser().resolve()
    if candidate == Path.cwd():
        raise InvalidRoot("путь указывает на текущий каталог")

    if not candidate.exists():
        raise InvalidRoot(f"путь не существует: {candidate}")
    if not candidate.is_dir():
        raise InvalidRoot(f"это не каталог: {candidate}")
    if not os.access(candidate, os.R_OK | os.X_OK):
        raise InvalidRoot(f"нет доступа на чтение: {candidate}")

    # Сначала системные пути, потом кэш: "/" — и родитель кэша, и системный,
    # и сообщение про системный путь точнее.
    reason = _deny_reason(candidate)
    if reason is not None:
        raise InvalidRoot(reason)

    cache_dir = get_settings().cache_dir.resolve()
    if cache_dir.is_relative_to(candidate):
        raise InvalidRoot(
            f"путь включает кэш booklib ({cache_dir}) — библиотека не может жить в своём кэше"
        )

    return candidate


def preview_root(path: Path, budget: int = 20_000) -> dict[str, int | bool]:
    """Лёгкий обход: посчитать книги/аудио по расширениям, выйти по бюджету.

    Возвращает {files, books, audio, truncated}. Скрытые каталоги и файлы
    пропускаются как в collect_groups — предпросмотр не должен показывать
    числа, которых не будет при реальном скане.
    """
    files = books = audio = 0
    truncated = False
    for _dirpath, dirnames, filenames in os.walk(path):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for filename in sorted(filenames):
            if filename.startswith("."):
                continue
            ext = Path(filename).suffix.lower()
            if ext in BOOK_EXTS:
                books += 1
            elif ext in AUDIO_EXTS:
                audio += 1
            else:
                continue
            files += 1
            if files >= budget:
                truncated = True
                return {"files": files, "books": books, "audio": audio, "truncated": True}
    return {"files": files, "books": books, "audio": audio, "truncated": truncated}
