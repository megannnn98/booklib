"""booklib — локальная витрина библиотеки.

Слушает только 127.0.0.1. Библиотека читается read-only; всё изменяемое состояние
(СУБД, кэш обложек) лежит в ~/.cache/booklib.
"""

from __future__ import annotations

import json
import shutil
import time
from contextlib import asynccontextmanager, closing

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from booklib import covers, opener
from booklib.config.settings import field_source, get_settings
from booklib.db import connect, init_state
from booklib.errors import LibraryUnavailable
from booklib.rootcheck import InvalidRoot, preview_root, validate_root
from booklib.service import apply_root, rescan
from booklib.taxonomy import load_taxonomy
from booklib.tools import REQUIRED_TOOLS

SORTS = {
    "title": "title COLLATE unicode_ci ASC",
    "added": "added_at DESC",
    "year": "year IS NULL, year DESC",
    "size": "size DESC",
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Старт процесса: одноразовая подготовка слота состояния (миграция legacy
    + root.txt) с корнем «до переключения» — см. db.init_state."""
    init_state()
    yield


app = FastAPI(title="booklib", docs_url=None, redoc_url=None, lifespan=lifespan)


@app.exception_handler(LibraryUnavailable)
def _unavailable(_request, exc: LibraryUnavailable) -> JSONResponse:
    """Корень не смонтирован или пуст — каталог оставляем как есть (503)."""
    return JSONResponse({"error": str(exc)}, status_code=503)


@app.exception_handler(InvalidRoot)
def _invalid_root(_request, exc: InvalidRoot) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=400)


class OpenRequest(BaseModel):
    key: str


class EditRequest(BaseModel):
    """Правка карточки. Пустая строка = снять правку с этого поля."""

    key: str
    title: str | None = None
    author: str | None = None
    section: str | None = None
    reset: bool = False


class SettingsRequest(BaseModel):
    """Смена корня библиотеки. scan_on_start опционален — для CLI-паритета."""

    root: str
    scan_on_start: bool | None = None


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


def library_mounted() -> bool:
    return get_settings().root.is_dir()


@app.get("/api/status")
def api_status() -> dict:
    settings = get_settings()
    mounted = library_mounted()
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS total, SUM(missing) AS missing, SUM(has_cover) AS covers FROM books"
        ).fetchone()
        last_scan = conn.execute("SELECT v FROM state WHERE k = 'last_scan'").fetchone()
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
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT COALESCE(o.section, b.section) AS section, COUNT(*) AS n FROM books b "
            "LEFT JOIN overrides o ON o.key = b.key "
            "WHERE b.missing = 0 GROUP BY 1"  # по алиасу: 'section' есть в обеих таблицах
        ).fetchall()

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
        # % и _ в запросе — это символы из имён файлов ("C++", "_v2", "x86_64", "100%"),
        # а не wildcard'ы. Без ESCAPE запрос "100%" матчил бы вообще всё.
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        where.append(
            "pylower(COALESCE(o.title, b.title) || ' ' || COALESCE(o.author, b.author, '') "
            "|| ' ' || b.key) LIKE ? ESCAPE '\\'"
        )
        params.append(f"%{escaped.lower()}%")

    sql = (
        "SELECT b.key, COALESCE(o.title, b.title) AS title, "
        "       COALESCE(o.author, b.author) AS author, b.year, "
        "       COALESCE(o.section, b.section) AS section, b.section_source, "
        "       b.formats_json, b.primary_file, b.size, b.has_cover, b.kind, b.dir, "
        "       (o.key IS NOT NULL) AS edited "
        "FROM books b LEFT JOIN overrides o ON o.key = b.key "
        f"WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ? OFFSET ?"
    )
    with closing(connect()) as conn:
        rows = conn.execute(sql, (*params, limit, offset)).fetchall()
        total = conn.execute(
            "SELECT COUNT(*) AS n FROM books b LEFT JOIN overrides o ON o.key = b.key "
            f"WHERE {' AND '.join(where)}",
            tuple(params),
        ).fetchone()["n"]

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
    # Проверяем не только наличие файла: после правки книги сканер ставит
    # has_cover=0, а старый jpg остаётся на диске до следующей генерации.
    with closing(connect()) as conn:
        row = conn.execute("SELECT has_cover FROM books WHERE key = ?", (key,)).fetchone()
    if row is None or not row["has_cover"]:
        raise HTTPException(status_code=404, detail="обложки нет")

    path = covers.cover_path(key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="обложки нет")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


@app.post("/api/rescan", dependencies=[Depends(require_own_page)])
def api_rescan() -> JSONResponse:
    return JSONResponse(rescan())


@app.get("/api/settings", dependencies=[Depends(require_own_page)])
def api_settings() -> dict:
    """Активные настройки + read-only справка. Смена корня — через POST."""
    settings = get_settings()
    return {
        "root": str(settings.root),
        "root_source": field_source("root"),
        "scan_on_start": settings.scan_on_start,
        "db": str(settings.db_path),
        "cover_dir": str(settings.cover_dir),
        "mounted": library_mounted(),
        "read_only": {
            "host": settings.host,
            "port": settings.port,
            "cover_width": settings.cover_width,
            "cover_max_height": settings.cover_max_height,
            "cover_quality": settings.cover_quality,
            "render_timeout_s": settings.render_timeout_s,
            "tools": {tool: shutil.which(tool) is not None for tool in REQUIRED_TOOLS},
        },
    }


@app.get("/api/settings/preview", dependencies=[Depends(require_own_page)])
def api_settings_preview(root: str) -> dict:
    """Предпросмотр нового корня: валидация + лёгкий подсчёт книг/аудио.

    Ноль книг — не ошибка, а поле в ответе: пользователь вправе завести новую
    библиотеку с пустой папки, UI покажет предупреждение.
    """
    path = validate_root(root)
    return {"root": str(path), **preview_root(path)}


@app.post("/api/settings", dependencies=[Depends(require_own_page)])
def api_update_settings(request: SettingsRequest) -> JSONResponse:
    """Применить новый корень (провалидировав) и сразу пересканировать.

    Orchestration в service.apply_root: тот же замок, что у /api/rescan, —
    смена корня не пересечётся с параллельным сканом. Конфиг пишется до
    рескана: выбор уже провалидирован, а если корень недоступен — 503 от
    exception_handler объясняет, почему каталог пуст.
    """
    return JSONResponse(apply_root(request.root, request.scan_on_start))


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
    with closing(connect()) as conn:
        # Именно базовые значения из books, а НЕ COALESCE с overrides: иначе правка
        # одного поля затирала бы уже существующую правку другого. Пример: у книги
        # свой title, пользователь меняет только раздел — форма пришлёт тот же title,
        # он совпадёт с текущим (со своей же правкой) и обнулился бы.
        base = conn.execute(
            "SELECT title, author, section FROM books WHERE key = ?",
            (request.key,),
        ).fetchone()
        if base is None:
            raise HTTPException(status_code=404, detail=f"нет такой карточки: {request.key}")

        def clean(value: str | None) -> str | None:
            return value.strip() or None if value is not None else None

        title, author, section = clean(request.title), clean(request.author), clean(request.section)

        # Форма присылает все три поля, даже если пользователь менял одно. Значение,
        # совпадающее с базовым, в overrides не пишем: иначе оно скопирует туда данные
        # из taxonomy.json и заморозит их — будущая перегенерация раскладки до карточки
        # уже не достучится, потому что COALESCE отдаст залипшую копию.
        title = title if title != base["title"] else None
        author = author if author != base["author"] else None
        section = section if section != base["section"] else None

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
    return {"action": action, "key": request.key}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(get_settings().static_dir / "index.html")


app.mount("/static", StaticFiles(directory=get_settings().static_dir), name="static")
