"""Валидация и предпросмотр корня: отказы, приёмы, счётчики, бюджет обхода."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from booklib.config.settings import get_settings
from booklib.rootcheck import InvalidRoot, _deny_reason, preview_root, validate_root
from tests.conftest import make_book


def test_validate_rejects_missing_path(tmp_path: Path) -> None:
    with pytest.raises(InvalidRoot, match="не существует"):
        validate_root(str(tmp_path / "nope"))


def test_validate_rejects_file(tmp_path: Path) -> None:
    path = tmp_path / "file"
    path.write_text("x")
    with pytest.raises(InvalidRoot, match="не каталог"):
        validate_root(str(path))


@pytest.mark.parametrize("bad", ["", "   ", "."])
def test_validate_rejects_empty_and_cwd(bad: str) -> None:
    """Пустая строка и '.' резолвятся в cwd — не должны становиться корнем."""
    with pytest.raises(InvalidRoot, match="путь не указан|текущий каталог"):
        validate_root(bad)


@pytest.mark.skipif(os.geteuid() == 0, reason="root читает всё — os.access не сработает")
def test_validate_rejects_unreadable_dir(tmp_path: Path) -> None:
    path = tmp_path / "locked"
    path.mkdir()
    path.chmod(0)
    try:
        with pytest.raises(InvalidRoot, match="доступа"):
            validate_root(str(path))
    finally:
        path.chmod(0o755)


def test_validate_rejects_system_paths(tmp_path: Path) -> None:
    # "/" и $HOME существуют везде; поддеревья $HOME — законный корень.
    for bad in ("/", str(Path.home())):
        with pytest.raises(InvalidRoot, match="системный"):
            validate_root(bad)


def test_deny_exact_rejects_mount_roots_themselves() -> None:
    """Каталоги монтирования и $HOME запрещены сами по себе — но не под ними."""
    for bad in ("/", "/home", "/media", "/mnt", "/run", "/run/media", str(Path.home())):
        assert _deny_reason(Path(bad)) is not None


def test_deny_tree_rejects_system_subtrees() -> None:
    for bad in ("/usr/share/doc", "/var/lib", "/etc/ssl", "/proc", "/sys/kernel"):
        assert _deny_reason(Path(bad)) is not None


def test_deny_reason_allows_mount_subtrees() -> None:
    """Штатные места библиотек: под каталогом монтирования и в $HOME.

    Мутация: вернуть проверку на поддерево для DENY_EXACT — этот тест падает,
    /run/media/b/... снова считается системным.
    """
    for ok in (
        "/run/media/b/DOWNLOADS/books",  # udisks2, Arch
        "/media/b/disk/books",  # монтирование Debian/Ubuntu
        "/mnt/data/books",
        str(Path.home() / "Books"),  # умолчание из настроек
    ):
        assert _deny_reason(Path(ok)) is None, ok


@pytest.mark.parametrize(
    "rel",
    [
        "run/media/b/DOWNLOADS/books",
        "media/b/disk/books",
        "mnt/data/books",
        "home/b/Books",
    ],
)
def test_validate_accepts_library_under_mount_subtrees(tmp_path: Path, rel: str) -> None:
    """Существующий каталог на глубине под каталогом монтирования принимается."""
    root = tmp_path / rel
    root.mkdir(parents=True)
    assert validate_root(str(root)) == root.resolve()


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
