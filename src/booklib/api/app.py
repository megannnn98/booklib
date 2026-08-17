"""booklib — локальная витрина библиотеки.

Слушает только 127.0.0.1. Библиотека читается read-only; всё изменяемое состояние
(СУБД, кэш обложек) лежит в ~/.cache/booklib.
"""

from __future__ import annotations

import json
import sqlite3
import time

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from booklib import covers, opener
from booklib.config.settings import get_settings
from booklib.scanner import LibraryUnavailable, collect_groups, connect, sync
from booklib.taxonomy import apply as apply_sections
from booklib.taxonomy import load_taxonomy

SORTS = {
    "title": "title COLLATE NOCASE ASC",
    "added": "added_at DESC",
    "year": "year IS NULL, year DESC",
    "size": "size DESC",
}

app = FastAPI(title="booklib", docs_url=None, redoc_url=None)


class OpenRequest(BaseModel):
    key: str


class EditRequest(BaseModel):
    """Правка карточки. Пустая строка = снять правку с этого поля."""

    key: str
    title: str | None = None
    author: str | None = None
    section: str | None = None
    reset: bool = False


def require_own_page(x_booklib: str | None = Header(default=None)) -> None:
    """Пускать только запросы со своей страницы.

    Сервис слушает localhost, но это НЕ защищает от чужой вкладки: любая открытая
    страница может послать POST на 127.0.0.1. Простой запрос с чужого origin не
    может выставить кастомный заголовок без CORS-preflight, а preflight мы не
    обслуживаем — значит наличие X-Booklib и есть признак своей страницы.
    Это важно именно для /api/open: он запускает процессы.
    """
    if x_booklib is None:
        raise HTTPException(status_code=403, detail="запрос не со страницы booklib")


def db() -> sqlite3.Connection:
    conn = connect()
    # LOWER() в SQLite не умеет кириллицу — регистронезависимый поиск делаем питоном
    conn.create_function("pylower", 1, lambda value: value.lower() if value else "")
    return conn


def library_mounted() -> bool:
    return get_settings().root.is_dir()


def rescan() -> dict:
    """Полный цикл обновления: скан → разделы → недостающие обложки."""
    started = time.time()
    groups = collect_groups()
    conn = connect()
    try:
        stats = sync(conn, groups)
        apply_sections(conn)
    finally:
        conn.close()
    cover_stats = covers.generate()
    return {
        **stats,
        "covers_built": cover_stats["built"],
        "covers_failed": cover_stats["failed"],
        "elapsed": round(time.time() - started, 2),
    }


@app.get("/api/status")
def api_status() -> dict:
    settings = get_settings()
    mounted = library_mounted()
    conn = db()
    row = conn.execute(
        "SELECT COUNT(*) AS total, SUM(missing) AS missing, SUM(has_cover) AS covers FROM books"
    ).fetchone()
    last_scan = conn.execute("SELECT v FROM state WHERE k = 'last_scan'").fetchone()
    conn.close()
    return {
        "mounted": mounted,
        "root": str(settings.root),
        "db": str(settings.db_path),
        "total": row["total"] or 0,
        "missing": row["missing"] or 0,
        "covers": row["covers"] or 0,
        "last_scan": float(last_scan["v"]) if last_scan else None,
    }


@app.get("/api/sections")
def api_sections() -> list[dict]:
    known, _ = load_taxonomy()
    conn = db()
    rows = conn.execute(
        "SELECT COALESCE(o.section, b.section) AS section, COUNT(*) AS n FROM books b "
        "LEFT JOIN overrides o ON o.key = b.key "
        "WHERE b.missing = 0 GROUP BY 1"  # по алиасу: 'section' есть в обеих таблицах
    ).fetchall()
    conn.close()

    counts = {row["section"]: row["n"] for row in rows if row["section"]}
    ordered = [s for s in known if s in counts] + sorted(set(counts) - set(known))
    return [{"name": name, "count": counts[name]} for name in ordered]


@app.get("/api/books")
def api_books(
    section: str | None = None,
    q: str | None = None,
    sort: str = "title",
    limit: int = Query(500, le=2000),
    offset: int = 0,
) -> dict:
    order = SORTS.get(sort, SORTS["title"])
    where = ["b.missing = 0"]
    params: list = []

    if section and section != "*":
        where.append("COALESCE(o.section, b.section) = ?")
        params.append(section)
    if q:
        where.append(
            "pylower(COALESCE(o.title, b.title) || ' ' || COALESCE(o.author, b.author, '') "
            "|| ' ' || b.key) LIKE ?"
        )
        params.append(f"%{q.lower()}%")

    sql = (
        "SELECT b.key, COALESCE(o.title, b.title) AS title, "
        "       COALESCE(o.author, b.author) AS author, b.year, "
        "       COALESCE(o.section, b.section) AS section, b.section_source, "
        "       b.formats_json, b.primary_file, b.size, b.has_cover, b.kind, b.dir, "
        "       (o.key IS NOT NULL) AS edited "
        "FROM books b LEFT JOIN overrides o ON o.key = b.key "
        f"WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ? OFFSET ?"
    )
    conn = db()
    rows = conn.execute(sql, (*params, limit, offset)).fetchall()
    total = conn.execute(
        "SELECT COUNT(*) AS n FROM books b LEFT JOIN overrides o ON o.key = b.key "
        f"WHERE {' AND '.join(where)}",
        tuple(params),
    ).fetchone()["n"]
    conn.close()

    books = [
        {
            "key": row["key"],
            "title": row["title"],
            "author": row["author"],
            "year": row["year"],
            "section": row["section"],
            "formats": json.loads(row["formats_json"]),
            "size_mb": round(row["size"] / 1048576, 1),
            "has_cover": bool(row["has_cover"]),
            "kind": row["kind"],
            "dir": row["dir"],
            "edited": bool(row["edited"]),
        }
        for row in rows
    ]
    return {"total": total, "books": books}


@app.get("/api/cover")
def api_cover(key: str) -> FileResponse:
    path = covers.cover_path(key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="обложки нет")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


@app.post("/api/rescan", dependencies=[Depends(require_own_page)])
def api_rescan() -> JSONResponse:
    try:
        return JSONResponse(rescan())
    except LibraryUnavailable as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)


@app.post("/api/open", dependencies=[Depends(require_own_page)])
def api_open(request: OpenRequest) -> dict:
    try:
        return opener.open_book(request.key)
    except opener.BookNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except opener.OutsideLibrary as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except opener.TargetMissing as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except opener.OpenError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/book", dependencies=[Depends(require_own_page)])
def api_edit(request: EditRequest) -> dict:
    """Сохранить правку в overrides.

    Правки живут отдельно от таблицы books: рескан и повторное применение
    taxonomy.json их не затирают, а выдача в /api/books берёт их через COALESCE.
    """
    conn = db()
    try:
        if conn.execute("SELECT 1 FROM books WHERE key = ?", (request.key,)).fetchone() is None:
            raise HTTPException(status_code=404, detail=f"нет такой карточки: {request.key}")

        def clean(value: str | None) -> str | None:
            return value.strip() or None if value is not None else None

        title, author, section = clean(request.title), clean(request.author), clean(request.section)

        if request.reset or not any((title, author, section)):
            conn.execute("DELETE FROM overrides WHERE key = ?", (request.key,))
            action = "reset"
        else:
            conn.execute(
                "INSERT INTO overrides(key, title, author, section, updated_at) "
                "VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET "
                "title=excluded.title, author=excluded.author, section=excluded.section, "
                "updated_at=excluded.updated_at",
                (request.key, title, author, section, time.time()),
            )
            action = "saved"
        conn.commit()
    finally:
        conn.close()
    return {"action": action, "key": request.key}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(get_settings().static_dir / "index.html")


app.mount("/static", StaticFiles(directory=get_settings().static_dir), name="static")
