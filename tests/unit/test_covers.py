"""Генерация обложек: устойчивость к битым и враждебным файлам.

Контент скачан из торрентов, поэтому повреждённый epub или подделанный zip —
штатная ситуация, а не исключительная. Одна такая книга не должна ронять рескан
всего каталога.
"""

from __future__ import annotations

import sqlite3
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from PIL import Image

from booklib import covers
from booklib.grouping import collect_groups
from booklib.scanner import sync
from tests.conftest import make_book


@pytest.fixture
def catalog(library: Path, db: sqlite3.Connection) -> sqlite3.Connection:
    make_book(library, "chemistry/Книга.pdf")
    sync(db, collect_groups())
    db.commit()
    return db


def test_cover_path_is_hashed(tmp_path: Path) -> None:
    """Ключ карточки содержит слэши и кириллицу — в имя файла он не подставляется."""
    path = covers.cover_path("philosophy/Эвола - Даосизм/x", tmp_path)

    assert path.parent == tmp_path
    assert path.name.endswith(".jpg")
    assert "/" not in path.name and "Эвола" not in path.name


def test_generate_survives_unexpected_exception(
    catalog: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Регрессия: DecompressionBombError и LargeZipFile наследуют Exception напрямую.

    Раньше work() ловил только CoverError, поэтому такое исключение пробивало
    ThreadPoolExecutor и роняло generate() → rescan() → 500 на весь каталог.
    """

    def explode(source: Path, destination: Path) -> None:
        raise Image.DecompressionBombError("слишком большая картинка")

    monkeypatch.setitem(covers.EXTRACTORS, ".pdf", explode)

    stats = covers.generate()

    assert stats["failed"] == 1
    assert stats["built"] == 0
    row = catalog.execute("SELECT has_cover, cover_error FROM books").fetchone()
    assert row["has_cover"] == 0
    assert "DecompressionBombError" in row["cover_error"]


def test_large_zip_file_is_reported_not_raised(
    catalog: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(source: Path, destination: Path) -> None:
        raise zipfile.LargeZipFile("zip64 required")

    monkeypatch.setitem(covers.EXTRACTORS, ".pdf", explode)

    assert covers.generate()["failed"] == 1


def test_embedded_image_size_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Zip-бомба: заявленный размер записи проверяется до распаковки в память."""
    epub = tmp_path / "bomb.epub"
    with zipfile.ZipFile(epub, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("content.opf", "<package/>")
        archive.writestr("cover.jpeg", b"\0" * 1024)

    monkeypatch.setattr(covers, "MAX_EMBEDDED_IMAGE_BYTES", 512)

    with pytest.raises(covers.CoverError, match="слишком большое"):
        covers._epub_cover_bytes(epub)


def test_epub_without_cover_reports_reason(tmp_path: Path) -> None:
    epub = tmp_path / "plain.epub"
    with zipfile.ZipFile(epub, "w") as archive:
        archive.writestr("content.opf", "<package/>")

    with pytest.raises(covers.CoverError, match="не найдена обложка"):
        covers._epub_cover_bytes(epub)


def test_fb2_without_images_reports_reason(tmp_path: Path) -> None:
    fb2 = tmp_path / "plain.fb2"
    fb2.write_bytes(b"<?xml version='1.0'?><FictionBook><body/></FictionBook>")

    with pytest.raises(covers.CoverError, match="нет встроенных изображений"):
        covers._fb2_cover_bytes(fb2)


def test_save_writes_atomically_and_leaves_no_temp_files(tmp_path: Path) -> None:
    """Регрессия: общий .tmp.jpg делал две одновременные генерации гонкой."""
    destination = tmp_path / "covers" / "x.jpg"
    covers._save(Image.new("RGB", (40, 60), "red"), destination)

    assert destination.exists()
    assert sorted(p.name for p in destination.parent.iterdir()) == ["x.jpg"]


def test_concurrent_save_of_same_cover_produces_valid_jpeg(tmp_path: Path) -> None:
    destination = tmp_path / "covers" / "same.jpg"
    destination.parent.mkdir(parents=True)

    def write(shade: int) -> None:
        covers._save(Image.new("RGB", (60, 90), (shade, shade, shade)), destination)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(write, range(8)))

    with Image.open(destination) as image:
        image.verify()
    assert list(destination.parent.iterdir()) == [destination]
