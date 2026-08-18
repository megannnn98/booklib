"""Валидация и предпросмотр корня: отказы, счётчики, бюджет обхода."""

from __future__ import annotations

from pathlib import Path

import pytest

from booklib.config.settings import get_settings
from booklib.rootcheck import InvalidRoot, preview_root, validate_root
from tests.conftest import make_book


def test_validate_rejects_missing_path(tmp_path: Path) -> None:
    with pytest.raises(InvalidRoot, match="не существует"):
        validate_root(str(tmp_path / "nope"))


def test_validate_rejects_file(tmp_path: Path) -> None:
    path = tmp_path / "file"
    path.write_text("x")
    with pytest.raises(InvalidRoot, match="не каталог"):
        validate_root(str(path))


def test_validate_rejects_system_paths(tmp_path: Path) -> None:
    for bad in ("/", str(Path.home()), str(Path.home() / "Downloads")):
        with pytest.raises(InvalidRoot, match="системный"):
            validate_root(bad)


def test_validate_rejects_cache_dir_and_its_parent(tmp_path: Path) -> None:
    """Обход родителя кэша затянет в СУБД и обложки — такой корень нельзя давать."""
    get_settings().cache_dir.mkdir(parents=True, exist_ok=True)
    with pytest.raises(InvalidRoot, match="кэш"):
        validate_root(str(get_settings().cache_dir))
    with pytest.raises(InvalidRoot, match="кэш"):
        validate_root(str(tmp_path))


def test_validate_accepts_library_dir(library: Path) -> None:
    assert validate_root(str(library)) == library.resolve()


def test_preview_counts_books_audio_and_skips_junk(library: Path) -> None:
    make_book(library, "math/Книга.pdf")
    make_book(library, "math/Книга 2.epub")
    make_book(library, "audio/01.mp3", b"\xff\xfb")
    make_book(library, "math/notes.txt", b"junk")
    make_book(library, "math/.скрытый.pdf")
    make_book(library, ".hidden/skip.pdf")

    preview = preview_root(library)

    assert preview == {"files": 3, "books": 2, "audio": 1, "truncated": False}


def test_preview_truncates_by_budget(library: Path) -> None:
    for name in ("a", "b", "c"):
        make_book(library, f"{name}.pdf")

    preview = preview_root(library, budget=1)

    assert preview == {"files": 1, "books": 1, "audio": 0, "truncated": True}
