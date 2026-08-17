"""Обход дерева библиотеки и склейка файлов в карточки книг.

Библиотека читается строго read-only — это активные раздачи qBittorrent,
переименование или перемещение сломает fastresume-файлы.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import StrEnum
from functools import cached_property
from pathlib import Path
from typing import TypedDict

from booklib.errors import LibraryUnavailable
from booklib.meta import normalize_basename, parse_meta
from booklib.paths import library_root, relative_to_root

BOOK_EXTS = (".pdf", ".djvu", ".djv", ".epub", ".fb2", ".rtf")
AUDIO_EXTS = (".mp3",)
FORMAT_PREFERENCE = (".pdf", ".djvu", ".djv", ".epub", ".fb2", ".rtf", ".mp3")

AUDIO_DIR_NAMES = {"audio", "аудио", "sound", "mp3"}
AUDIO_GROUP_MARKER = "__audio__"


class Kind(StrEnum):
    BOOK = "book"
    AUDIO = "audio"


class ScanReport(TypedDict):
    """Сводка обхода: сколько файлов, сколько карточек, сколько склеено."""

    files: int
    cards: int
    books: int
    audio: int
    multi_format: int
    merged_stems: int
    by_ext: dict[str, int]


def _file_rank(path: Path) -> tuple[int, str]:
    """Порядок файлов карточки: предпочтительный формат, потом имя."""
    ext = path.suffix.lower()
    order = FORMAT_PREFERENCE.index(ext) if ext in FORMAT_PREFERENCE else 99
    return (order, path.name)


# frozen=True + cached_property работают вместе только потому, что у класса нет
# __slots__: cached_property.__get__ пишет в instance.__dict__ в обход __setattr__.
# Добавление slots=True уронит formats/size_mtime в рантайме.
@dataclass(frozen=True)
class BookGroup:
    key: str
    dir: str
    basename: str
    title: str
    author: str | None
    year: int | None
    kind: Kind = Kind.BOOK
    files: tuple[Path, ...] = ()

    def __post_init__(self) -> None:
        # files сортируются один раз при конструировании: раньше каждый вызов
        # sorted_files прогонял сортировку заново.
        object.__setattr__(self, "files", tuple(sorted(self.files, key=_file_rank)))

    @cached_property
    def formats(self) -> list[str]:
        """Расширения в порядке предпочтения — порядок задан сортировкой files."""
        seen: list[str] = []
        for path in self.files:
            ext = path.suffix.lower().lstrip(".")
            if ext not in seen:
                seen.append(ext)
        return seen

    @property
    def primary_file(self) -> Path:
        return self.files[0]

    @cached_property
    def size_mtime(self) -> tuple[int, float]:
        """(суммарный размер, максимум mtime) — один проход .stat() на файл.

        Лениво: --dry-run и --show до stat вообще не доходят, они не должны платить
        за 506 файлов внешнего диска.
        """
        total = 0
        newest = 0.0
        for path in self.files:
            stat = path.stat()
            total += stat.st_size
            newest = max(newest, stat.st_mtime)
        return total, newest


@dataclass
class _Accum:
    """Накопитель обхода: files копятся списком, карточка строится после, уже immutable."""

    dir: str
    basename: str
    kind: Kind
    title: str
    author: str | None
    year: int | None
    files: list[Path] = field(default_factory=list)


def _audio_title(directory: Path, root: Path) -> str:
    name = directory.name
    if name.lower() in AUDIO_DIR_NAMES and directory != root:
        return f"{directory.parent.name} (аудио)"
    return f"{name} (аудио)"


def _card_meta(
    kind: Kind, basename: str, directory: Path, root: Path
) -> tuple[str, str | None, int | None]:
    """Название/автор/год карточки — там, где живой directory ещё под рукой."""
    if kind is Kind.AUDIO:
        return _audio_title(directory, root), None, None
    return parse_meta(basename)


def collect_groups() -> dict[str, BookGroup]:
    """Обойти дерево и собрать логические книги. Только чтение."""
    root = library_root()
    if not root.is_dir():
        raise LibraryUnavailable(f"корень библиотеки недоступен: {root}")

    accums: dict[str, _Accum] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        directory = Path(dirpath)
        reldir = "" if directory == root else relative_to_root(directory)

        for filename in sorted(filenames):
            if filename.startswith("."):
                continue
            path = directory / filename
            ext = path.suffix.lower()

            if ext in BOOK_EXTS:
                basename = normalize_basename(path.stem)
                kind = Kind.BOOK
            elif ext in AUDIO_EXTS:
                basename = AUDIO_GROUP_MARKER
                kind = Kind.AUDIO
            else:
                continue

            key = f"{reldir}/{basename}" if reldir else basename
            accum = accums.get(key)
            if accum is None:
                title, author, year = _card_meta(kind, basename, directory, root)
                accum = _Accum(reldir, basename, kind, title, author, year)
                accums[key] = accum
            accum.files.append(path)

    return {
        key: BookGroup(
            key=key,
            dir=accum.dir,
            basename=accum.basename,
            kind=accum.kind,
            title=accum.title,
            author=accum.author,
            year=accum.year,
            files=tuple(accum.files),
        )
        for key, accum in accums.items()
    }


def stats_report(groups: dict[str, BookGroup]) -> ScanReport:
    """Сводка по результатам обхода — для CLI и тестов."""
    by_ext: dict[str, int] = {}
    files_total = 0
    multi_format = 0
    merged_stems = 0

    for group in groups.values():
        files_total += len(group.files)
        stems: set[str] = set()
        for path in group.files:
            ext = path.suffix.lower().lstrip(".")
            by_ext[ext] = by_ext.get(ext, 0) + 1
            stems.add(path.stem)
        if len(group.formats) > 1:
            multi_format += 1
        if len(stems) > 1:
            merged_stems += 1

    return {
        "files": files_total,
        "cards": len(groups),
        "books": sum(1 for g in groups.values() if g.kind is Kind.BOOK),
        "audio": sum(1 for g in groups.values() if g.kind is Kind.AUDIO),
        "multi_format": multi_format,
        "merged_stems": merged_stems,
        "by_ext": dict(sorted(by_ext.items())),
    }
