"""Сканер: группировка карточек, инкрементальность, guard от отключённого диска."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from booklib.errors import LibraryUnavailable
from booklib.grouping import collect_groups, stats_report
from booklib.scanner import sync
from tests.conftest import make_book


def test_same_book_in_many_formats_is_one_card(library: Path) -> None:
    for ext in ("pdf", "epub", "fb2", "rtf"):
        make_book(library, f"philosophy/Эвола - Даосизм - 2020/Эвола - Даосизм - 2020.{ext}")

    groups = collect_groups()

    assert len(groups) == 1
    card = next(iter(groups.values()))
    assert card.formats == ["pdf", "epub", "fb2", "rtf"]
    # в nemo выделяем pdf, а не rtf
    assert card.primary_file.suffix == ".pdf"


def test_layout_variants_collapse(library: Path) -> None:
    make_book(library, "Сюэ Фэй - Притчи - 2019/Сюэ Фэй - Притчи - 2019.a4.pdf")
    make_book(library, "Сюэ Фэй - Притчи - 2019/Сюэ Фэй - Притчи - 2019.a6.pdf")

    assert len(collect_groups()) == 1


def test_different_volumes_stay_separate(library: Path) -> None:
    """Шесть томов Михайловского — шесть карточек, а не одна папка-книга."""
    for number in range(1, 7):
        make_book(library, f"philosophy/Михайловский/sochineniia0{number}mikh.djvu")

    assert len(collect_groups()) == 6


def test_audio_folder_is_one_card(library: Path) -> None:
    for number in range(1, 6):
        make_book(library, f"languages/Испанский/Audio/{number:02d}.mp3", b"\xff\xfb")

    groups = collect_groups()

    assert len(groups) == 1
    card = next(iter(groups.values()))
    assert card.kind == "audio"
    assert len(card.files) == 5


def test_junk_files_are_ignored(library: Path) -> None:
    make_book(library, "chemistry/Книга.pdf")
    make_book(library, "chemistry/[TGx]Downloaded from torrentgalaxy.to .txt", b"junk")
    make_book(library, "chemistry/Get Latest Books.html", b"<html>")
    make_book(library, "chemistry/Code.zip", b"PK")

    groups = collect_groups()

    assert len(groups) == 1
    assert stats_report(groups)["by_ext"] == {"pdf": 1}


def test_sync_is_incremental(library: Path, db: sqlite3.Connection) -> None:
    make_book(library, "a.pdf")
    assert sync(db, collect_groups())["added"] == 1

    second = sync(db, collect_groups())
    assert (second["added"], second["updated"], second["unchanged"]) == (0, 0, 1)

    make_book(library, "b.pdf")
    third = sync(db, collect_groups())
    assert (third["added"], third["unchanged"]) == (1, 1)


def test_missing_root_raises() -> None:
    # Фикстуру library НЕ запрашиваем: BOOKLIB_ROOT из isolated_settings указывает
    # на несозданный tmp_path/"library", и обход обязан упасть.
    with pytest.raises(LibraryUnavailable):
        collect_groups()


def test_empty_scan_does_not_wipe_catalog(library: Path, db: sqlite3.Connection) -> None:
    """Ключевой guard: диск отвалился → каталог остаётся нетронутым.

    Без него одна перезагрузка без внешнего диска пометила бы все карточки
    пропавшими и стёрла бы ручную раскладку по разделам.
    """
    make_book(library, "a.pdf")
    make_book(library, "b.pdf")
    sync(db, collect_groups())

    with pytest.raises(LibraryUnavailable):
        sync(db, {})

    row = db.execute("SELECT COUNT(*) AS n, SUM(missing) AS missing FROM books").fetchone()
    assert (row["n"], row["missing"]) == (2, 0)


def test_deleted_book_is_marked_missing_not_removed(library: Path, db: sqlite3.Connection) -> None:
    """Пропажа одной книги — это missing, а не удаление строки: правки к ней должны выжить."""
    make_book(library, "a.pdf")
    book_b = make_book(library, "b.pdf")
    sync(db, collect_groups())

    book_b.unlink()
    stats = sync(db, collect_groups())

    assert stats["missing"] == 1
    assert db.execute("SELECT COUNT(*) AS n FROM books").fetchone()["n"] == 2
