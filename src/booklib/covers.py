#!/usr/bin/env python3
"""Генерация превью обложек в ~/.cache/booklib/covers.

PDF  — первая страница через pdftocairo (poppler 26.07 не пишет jpeg в stdout,
       поэтому рендерим во временный файл).
DJVU — первая страница через ddjvu в ppm, дальше Pillow.
EPUB — обложка из OPF-манифеста.
FB2  — base64 из <binary>, на который ссылается <coverpage>.
RTF/MP3 — обложки нет, фронтенд рисует плейсхолдер.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

from booklib.config.settings import get_settings
from booklib.scanner import connect, library_root

RENDERABLE_EXTS = (".pdf", ".djvu", ".djv", ".epub", ".fb2")

# Для обложки epub/fb2 идут первыми: там лежит настоящая обложка книги, тогда как
# первая страница PDF/DJVU часто оказывается схемой, картой или пустым титулом.
# Это НЕ порядок primary_file — тот отвечает за то, какой файл выделять в nemo.
COVER_SOURCE_PREFERENCE = (".epub", ".fb2", ".pdf", ".djvu", ".djv")

XLINK_HREF_RE = re.compile(rb'<image[^>]*href\s*=\s*["\']#([^"\']+)["\']', re.IGNORECASE)
BINARY_RE_TEMPLATE = rb'<binary[^>]*id\s*=\s*["\']%s["\'][^>]*>(.*?)</binary>'
ANY_IMAGE_BINARY_RE = re.compile(
    rb'<binary[^>]*content-type\s*=\s*["\']image/[^"\']*["\'][^>]*>(.*?)</binary>',
    re.IGNORECASE | re.DOTALL,
)
EPUB_COVER_NAME_RE = re.compile(r"cover.*\.(jpe?g|png)$", re.IGNORECASE)


class CoverError(RuntimeError):
    """Обложку получить не удалось — причина уходит в books.cover_error."""


def cover_path(key: str, cover_dir: Path | None = None) -> Path:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
    base = cover_dir if cover_dir is not None else get_settings().cover_dir
    return base / f"{digest}.jpg"


def _save(image: Image.Image, destination: Path) -> None:
    settings = get_settings()
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.thumbnail((settings.cover_width, settings.cover_max_height), Image.Resampling.LANCZOS)
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_suffix(".tmp.jpg")
    image.save(tmp, "JPEG", quality=settings.cover_quality, optimize=True)
    tmp.replace(destination)


def _run(cmd: list[str]) -> subprocess.CompletedProcess[bytes]:
    timeout = get_settings().render_timeout_s
    try:
        return subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise CoverError(f"таймаут {timeout} с: {cmd[0]}") from exc
    except FileNotFoundError as exc:
        raise CoverError(f"утилита не найдена: {cmd[0]}") from exc


def _from_pdf(source: Path, destination: Path) -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        prefix = Path(tmpdir) / "page"
        result = _run(
            [
                "pdftocairo",
                "-jpeg",
                "-f",
                "1",
                "-l",
                "1",
                "-singlefile",
                "-scale-to-x",
                str(get_settings().cover_width),
                "-scale-to-y",
                "-1",
                str(source),
                str(prefix),
            ]
        )
        rendered = prefix.with_suffix(".jpg")
        if not rendered.exists():
            stderr = result.stderr.decode("utf-8", "replace").strip()
            raise CoverError(f"pdftocairo: {stderr or 'страница не отрендерилась'}")
        with Image.open(rendered) as image:
            _save(image, destination)


def _from_djvu(source: Path, destination: Path) -> None:
    settings = get_settings()
    result = _run(
        [
            "ddjvu",
            "-format=ppm",
            "-page=1",
            f"-size={settings.cover_width}x{settings.cover_max_height}",
            str(source),
            "/dev/stdout",
        ]
    )
    if not result.stdout:
        stderr = result.stderr.decode("utf-8", "replace").strip()
        raise CoverError(f"ddjvu: {stderr or 'пустой вывод'}")
    with Image.open(io.BytesIO(result.stdout)) as image:
        _save(image, destination)


def _epub_cover_bytes(source: Path) -> bytes:
    with zipfile.ZipFile(source) as archive:
        names = archive.namelist()

        opf_name = next((n for n in names if n.lower().endswith(".opf")), None)
        if opf_name:
            root = ET.fromstring(archive.read(opf_name))
            ns = {"opf": "http://www.idpf.org/2007/opf"}
            manifest = {
                item.get("id"): item.get("href")
                for item in root.iterfind(".//opf:manifest/opf:item", ns)
            }
            cover_id = next(
                (
                    m.get("content")
                    for m in root.iterfind(".//opf:metadata/opf:meta", ns)
                    if (m.get("name") or "").lower() == "cover"
                ),
                None,
            )
            href = manifest.get(cover_id) if cover_id else None
            if not href:
                href = next(
                    (
                        item.get("href")
                        for item in root.iterfind(".//opf:manifest/opf:item", ns)
                        if "cover-image" in (item.get("properties") or "")
                    ),
                    None,
                )
            if href:
                base = Path(opf_name).parent
                candidate = str(base / href).lstrip("./")
                for name in (candidate, href):
                    if name in names:
                        return archive.read(name)

        fallback = next((n for n in names if EPUB_COVER_NAME_RE.search(n)), None)
        if fallback:
            return archive.read(fallback)
    raise CoverError("в epub не найдена обложка")


def _from_epub(source: Path, destination: Path) -> None:
    with Image.open(io.BytesIO(_epub_cover_bytes(source))) as image:
        _save(image, destination)


def _fb2_cover_bytes(source: Path) -> bytes:
    raw = source.read_bytes()
    match = XLINK_HREF_RE.search(raw[:200_000])
    if match:
        cover_id = re.escape(match.group(1))
        binary = re.search(BINARY_RE_TEMPLATE % cover_id, raw, re.IGNORECASE | re.DOTALL)
        if binary:
            return base64.b64decode(binary.group(1))
    binary = ANY_IMAGE_BINARY_RE.search(raw)
    if binary:
        return base64.b64decode(binary.group(1))
    raise CoverError("в fb2 нет встроенных изображений")


def _from_fb2(source: Path, destination: Path) -> None:
    with Image.open(io.BytesIO(_fb2_cover_bytes(source))) as image:
        _save(image, destination)


EXTRACTORS = {
    ".pdf": _from_pdf,
    ".djvu": _from_djvu,
    ".djv": _from_djvu,
    ".epub": _from_epub,
    ".fb2": _from_fb2,
}


def build_cover(files: list[str], destination: Path, root: Path | None = None) -> str:
    """Пробовать файлы книги по порядку предпочтения, пока обложка не получится.

    Возвращает расширение сработавшего файла. Бросает CoverError, если не смог ни один.
    """

    def source_rank(relative: str) -> tuple[int, str]:
        extension = Path(relative).suffix.lower()
        order = (
            COVER_SOURCE_PREFERENCE.index(extension) if extension in COVER_SOURCE_PREFERENCE else 99
        )
        return (order, relative)

    errors: list[str] = []
    for relative in sorted(files, key=source_rank):
        extension = Path(relative).suffix.lower()
        extractor = EXTRACTORS.get(extension)
        if extractor is None:
            continue
        source = library_root(root) / relative
        if not source.exists():
            errors.append(f"{extension}: файл исчез")
            continue
        try:
            extractor(source, destination)
            return extension
        except (CoverError, OSError, ValueError, ET.ParseError, zipfile.BadZipFile) as exc:
            errors.append(f"{extension}: {exc}")
    if not errors:
        raise CoverError("нет форматов, из которых можно взять обложку")
    raise CoverError("; ".join(errors)[:300])


def generate(force: bool = False, only: str | None = None, workers: int = 4) -> dict[str, int]:
    conn = connect()
    query = "SELECT key, files_json, formats_json, has_cover FROM books WHERE missing = 0"
    params: tuple = ()
    if only:
        query += " AND key LIKE ?"
        params = (f"%{only}%",)
    rows = conn.execute(query, params).fetchall()

    todo = []
    stats = {"built": 0, "skipped": 0, "failed": 0, "no_source": 0}
    for row in rows:
        destination = cover_path(row["key"])
        if not force and row["has_cover"] and destination.exists():
            stats["skipped"] += 1
            continue
        files = json.loads(row["files_json"])
        if not any(Path(f).suffix.lower() in RENDERABLE_EXTS for f in files):
            conn.execute(
                "UPDATE books SET has_cover = 0, cover_error = ? WHERE key = ?",
                ("формат без обложки", row["key"]),
            )
            stats["no_source"] += 1
            continue
        todo.append((row["key"], files, destination))

    def work(item: tuple[str, list[str], Path]) -> tuple[str, str | None]:
        key, files, destination = item
        try:
            build_cover(files, destination)
            return key, None
        except CoverError as exc:
            return key, str(exc)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for key, error in pool.map(work, todo):
            if error is None:
                conn.execute(
                    "UPDATE books SET has_cover = 1, cover_error = NULL WHERE key = ?", (key,)
                )
                stats["built"] += 1
            else:
                conn.execute(
                    "UPDATE books SET has_cover = 0, cover_error = ? WHERE key = ?", (error, key)
                )
                stats["failed"] += 1

    conn.commit()
    conn.close()
    return stats


def report() -> None:
    conn = connect()
    total = conn.execute("SELECT COUNT(*) AS n FROM books WHERE missing = 0").fetchone()["n"]
    with_cover = conn.execute(
        "SELECT COUNT(*) AS n FROM books WHERE missing = 0 AND has_cover = 1"
    ).fetchone()["n"]
    print(f"обложек: {with_cover} из {total}")

    rows = conn.execute(
        "SELECT key, formats_json, cover_error FROM books "
        "WHERE missing = 0 AND has_cover = 0 ORDER BY cover_error, key"
    ).fetchall()
    print(f"\nбез обложки: {len(rows)}")
    for row in rows:
        formats = ",".join(json.loads(row["formats_json"]))
        print(f"  [{formats:<18}] {row['key'][:70]}")
        print(f"      причина: {row['cover_error']}")
    conn.close()
