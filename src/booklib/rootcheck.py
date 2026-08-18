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

# Пути, которые не могут быть корнем библиотеки: обход них уйдёт в минуты
# или затянет в кэш booklib. $HOME вычисляется динамически — он свой у каждого.
SYSTEM_PATHS = ("/", "/home", "/run", "/run/media", "/media", "/mnt", "/usr", "/var", "/etc")


class InvalidRoot(ValueError):
    """Корень не годится — с человекочитаемой причиной."""


def _system_paths() -> list[Path]:
    return [Path(path) for path in (*SYSTEM_PATHS, str(Path.home()))]


def validate_root(value: str) -> Path:
    """Разобрать, нормализовать и проверить корень. Возвращает resolved Path."""
    candidate = Path(value).expanduser().resolve()

    if not candidate.exists():
        raise InvalidRoot(f"путь не существует: {candidate}")
    if not candidate.is_dir():
        raise InvalidRoot(f"это не каталог: {candidate}")
    if not os.access(candidate, os.R_OK | os.X_OK):
        raise InvalidRoot(f"нет доступа на чтение: {candidate}")

    # Сначала системные пути, потом кэш: "/" — и родитель кэша, и системный,
    # и сообщение про системный путь точнее.
    for system in _system_paths():
        # "/" — родитель всего, поэтому для него запрещено только равенство;
        # остальные системные каталоги нельзя и обходить целиком.
        inside = candidate.is_relative_to(system) and system != Path("/")
        if candidate == system or inside:
            raise InvalidRoot(f"системный путь не подходит как корень библиотеки: {candidate}")

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
