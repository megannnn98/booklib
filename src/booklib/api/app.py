"""booklib — локальная витрина библиотеки.

Слушает только 127.0.0.1. Библиотека читается read-only; всё изменяемое состояние
(СУБД, кэш обложек) лежит в ~/.cache/booklib.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import sys
import time
from contextlib import asynccontextmanager, closing
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from booklib import covers, opener, tags
from booklib.config.settings import field_source, get_settings
from booklib.db import connect, init_state
from booklib.errors import LibraryUnavailable
from booklib.paths import library_root
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

# Адреса, считающиеся «с самого компьютера». Только для них открыты
# привилегированные ручки. X-Forwarded-* не влияет на определение peer и может
# только понизить права markerless-запроса, прошедшего через Caddy.
LOCAL_HOSTS = frozenset({"127.0.0.1", "::1"})

# Маркеры от локального Caddy. Remote понижает права, Admin повышает их только
# для loopback-peer; Desktop определяет именно браузер хоста, а не полномочия.
# Подробности — в docstring is_local_request(). Они влияют только на
# require_local; публичные ручки (/api/books, /api/sections, /api/cover,
# /api/files, /api/download, /api/tags) от них не зависят.
PROXY_REMOTE_HEADER = "X-Booklib-Remote"
PROXY_ADMIN_HEADER = "X-Booklib-Admin"
PROXY_DESKTOP_HEADER = "X-Booklib-Desktop"
# Caddy reverse_proxy always adds these. With proxy_headers=False they remain
# evidence that the loopback peer is a proxy, not an input to peer resolution.
FORWARDED_HEADERS = ("x-forwarded-for", "x-forwarded-host", "x-forwarded-proto")


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


@app.exception_handler(tags.TagError)
def _tag_error(_request, exc: tags.TagError) -> JSONResponse:
    payload: dict[str, object] = {"detail": str(exc)}
    if isinstance(exc, tags.TagInUse):
        payload["count"] = exc.count
    return JSONResponse(payload, status_code=exc.status)


class OpenRequest(BaseModel):
    key: str


class EditRequest(BaseModel):
    """Правка карточки. Пустая строка = снять правку с этого поля."""

    key: str
    title: str | None = None
    author: str | None = None
    section: str | None = None
    tags: list[str] | None = None
    reset: bool = False


class SettingsRequest(BaseModel):
    """Смена корня библиотеки. scan_on_start опционален — для CLI-паритета."""

    root: str
    scan_on_start: bool | None = None


class TagCreateRequest(BaseModel):
    name: str
    kind: str = "custom"
    description: str | None = None


class TagUpdateRequest(BaseModel):
    name: str | None = None
    kind: str | None = None
    description: str | None = None


class AliasRequest(BaseModel):
    alias: str


class MergeRequest(BaseModel):
    source: int
    target: int


class BookTagsRequest(BaseModel):
    tags: list[str]


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


def is_local_request(request: Request) -> bool:
    """Запрос пришёл с самого компьютера (обратная петля), а не из сети.

    Модель доверия: Booklib слушает только loopback, поэтому доверять
    X-Booklib-Admin можно только локальному Caddy. Caddy сначала удаляет
    присланные клиентом маркеры, затем ставит Admin для доверенной LAN и
    Remote для всех остальных. Удалённый peer не может повысить права
    поддельным Admin или X-Forwarded-For.

    Remote имеет приоритет над Admin: дубликаты или противоречивые маркеры
    fail closed. Проксированный loopback без Admin тоже read-only: это не
    позволяет ошибке в конфигурации Caddy открыть административные ручки.
    Прямой loopback без forwarded-заголовков остаётся административным.
    """
    client = request.client
    if client is None:
        return False
    if client.host not in LOCAL_HOSTS:
        return False
    if "1" in request.headers.getlist(PROXY_REMOTE_HEADER):
        return False
    if "1" in request.headers.getlist(PROXY_ADMIN_HEADER):
        return True
    return not any(header in request.headers for header in FORWARDED_HEADERS)


def is_host_desktop_request(request: Request) -> bool:
    """Запрос пришёл из браузера, запущенного на хосте.

    Прямой loopback — это браузер хоста. Через Caddy хост доказывается только
    Desktop-маркером, который Caddy ставит для стабильного IPv4 хоста; Admin
    для trusted LAN намеренно недостаточен. Нет или конфликт маркеров —
    fail-closed: UI показывает форматы для скачивания, а не запускает nemo.
    """
    client = request.client
    if client is None or client.host not in LOCAL_HOSTS:
        return False
    if "1" in request.headers.getlist(PROXY_REMOTE_HEADER):
        return False
    if "1" in request.headers.getlist(PROXY_DESKTOP_HEADER):
        return True
    return not any(header in request.headers for header in FORWARDED_HEADERS)


def require_local(request: Request) -> None:
    """Пускать только с самого компьютера. Fail closed: отсутствие пира — не локально."""
    if not is_local_request(request):
        raise HTTPException(
            status_code=403, detail="привилегированная ручка доступна только с самого компьютера"
        )


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


# Все ручки, которые что-то меняют или запускают процессы, живут в одном роутере
# с зависимостью require_local (+ require_own_page): новая мутирующая ручка,
# добавленная сюда, не может «забыть» проверку роли — она на роутере целиком.
priv_routes = APIRouter(
    dependencies=[Depends(require_own_page), Depends(require_local)],
    tags=["privileged"],
)


@app.get("/api/status")
def api_status(request: Request) -> dict:
    settings = get_settings()
    mounted = library_mounted()
    local = is_local_request(request)
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS total, SUM(missing) AS missing, SUM(has_cover) AS covers FROM books"
        ).fetchone()
        last_scan = conn.execute("SELECT v FROM state WHERE k = 'last_scan'").fetchone()
    status = {
        "mounted": mounted,
        "local": local,
        "host_desktop": is_host_desktop_request(request),
        "total": row["total"] or 0,
        "missing": row["missing"] or 0,
        "covers": row["covers"] or 0,
        "last_scan": float(last_scan["v"]) if last_scan else None,
    }
    if local:
        # Абсолютные пути ФС хоста не показываем сетевому гостю.
        status["root"] = str(settings.root)
        status["db"] = str(settings.db_path)
    return status


@app.get("/api/sections")
def api_sections() -> list[dict]:
    known, _, _ = load_taxonomy()
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT COALESCE(o.section, b.section) AS section, COUNT(*) AS n FROM books b "
            "LEFT JOIN overrides o ON o.key = b.key "
            "WHERE b.missing = 0 GROUP BY 1"  # по алиасу: 'section' есть в обеих таблицах
        ).fetchall()

    counts = {row["section"]: row["n"] for row in rows if row["section"]}
    ordered = [s for s in known if s in counts] + sorted(set(counts) - set(known))
    return [{"name": name, "count": counts[name]} for name in ordered]


@app.get("/api/tags")
def api_tags() -> list[dict]:
    with closing(connect()) as conn:
        return tags.list_tags(conn)


@app.get("/api/books")
def api_books(
    *,
    section: str | None = None,
    q: str | None = None,
    tag: Annotated[list[str] | None, Query()] = None,
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
        title_clause = (
            "pylower(COALESCE(o.title, b.title) || ' ' || COALESCE(o.author, b.author, '') "
            "|| ' ' || b.key) LIKE ? ESCAPE '\\'"
        )
        tag_clause = (
            "EXISTS (SELECT 1 FROM book_tags bt JOIN tags t ON t.id = bt.tag_id "
            "LEFT JOIN tag_aliases a ON a.tag_id = t.id "
            "WHERE bt.book_key = b.key AND (pylower(t.name) LIKE ? ESCAPE '\\' "
            "OR pylower(a.alias) LIKE ? ESCAPE '\\'))"
        )
        where.append(f"({title_clause} OR {tag_clause})")
        params.extend([f"%{escaped.lower()}%"] * 3)
    if tag:
        with closing(connect()) as conn:
            try:
                tag_ids = tags.resolve(conn, tag)
            except tags.TagNotFound as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        for tag_id in tag_ids:
            where.append(
                "EXISTS (SELECT 1 FROM book_tags bt WHERE bt.book_key = b.key AND bt.tag_id = ?)"
            )
            params.append(tag_id)

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
        book_tags = tags.tags_for(conn, [row["key"] for row in rows])

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
            "tags": book_tags.get(row["key"], []),
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


def _card_files(key: str, conn: sqlite3.Connection) -> list[str]:
    """Относительные пути файлов карточки в том порядке, что у primary_file
    (FORMAT_PREFERENCE → имя): files_json кэширует group.files, уже отсортированный
    по этому правилу. Несуществующая карточка — 404."""
    row = conn.execute("SELECT files_json FROM books WHERE key = ?", (key,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"нет такой карточки: {key}")
    return json.loads(row["files_json"])


@app.get("/api/files")
def api_files(key: str) -> list[dict[str, str | float | None]]:
    """Лист файлов карточки для скачивания: ссылка на каждый формат.

    Публичная ручка (без X-Booklib): листом можно делиться по ссылке. Порядок —
    тот же, что у primary_file, чтобы первым стоял вариант, который удобнее
    скачать целиком. Размер берём из stat на лету: в СУБД хранится только
    суммарный размер книг, не пофайлово.
    """
    with closing(connect()) as conn:
        files = _card_files(key, conn)
    root = library_root()
    result = []
    for rel in files:
        path = root / rel
        try:
            size = path.stat().st_size
        except OSError:
            size = None
        result.append(
            {
                "file": rel,
                "name": path.name,
                "format": Path(rel).suffix.lower().lstrip("."),
                "size_mb": round(size / 1048576, 2) if size is not None else None,
            }
        )
    return result


@app.get("/api/download")
def api_download(request: Request, key: str, file: str) -> FileResponse:
    """Отдать один файл карточки. Публичная — ссылкой можно делиться.

    Две независимые guard'а: file должен быть элементом files_json этой карточки
    (whitelist по построению — чужой файл в ЭТУ карточку не подсунешь), и после
    resolve() путь обязан остаться в корне библиотеки (инвариант №5). Коды как у
    opener: нет ключа → 404, файл не из карточки → 403, нет на диске → 503.
    """
    with closing(connect()) as conn:
        files = _card_files(key, conn)
    if file not in files:
        raise HTTPException(status_code=403, detail="файл не принадлежит этой карточке")

    root = library_root().resolve()
    target = root / file
    resolved = target.resolve()
    if not resolved.is_relative_to(root):
        raise HTTPException(status_code=403, detail="путь вне библиотеки")

    try:
        size = resolved.stat().st_size
    except OSError as exc:
        raise HTTPException(
            status_code=503, detail=f"файл недоступен (диск отключён?): {target}"
        ) from exc

    # Каждая выгрузка — в stderr (журнал journald): без этого «кто выкачал 4 ГБ»
    # не диагностируется. Данные — просто факты, имен выкачанных файлов в лог
    # целиком не дублируем (они уже в ответе).
    print(
        f"download ip={request.client.host if request.client else '?'} "
        f"fwd={request.headers.get('x-forwarded-for', '-')} "
        f"key={key} file={file} size={size}",
        file=sys.stderr,
        flush=True,
    )
    return FileResponse(resolved, filename=resolved.name)


@priv_routes.post("/api/rescan")
def api_rescan() -> JSONResponse:
    return JSONResponse(rescan())


@priv_routes.get("/api/settings")
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


@priv_routes.get("/api/settings/preview")
def api_settings_preview(root: str) -> dict:
    """Предпросмотр нового корня: валидация + лёгкий подсчёт книг/аудио.

    Ноль книг — не ошибка, а поле в ответе: пользователь вправе завести новую
    библиотеку с пустой папки, UI покажет предупреждение.
    """
    path = validate_root(root)
    return {"root": str(path), **preview_root(path)}


@priv_routes.post("/api/settings")
def api_update_settings(request: SettingsRequest) -> JSONResponse:
    """Применить новый корень (провалидировав) и сразу пересканировать.

    Orchestration в service.apply_root: тот же замок, что у /api/rescan, —
    смена корня не пересечётся с параллельным сканом. Конфиг пишется до
    рескана: выбор уже провалидирован, а если корень недоступен — 503 от
    exception_handler объясняет, почему каталог пуст.
    """
    return JSONResponse(apply_root(request.root, request.scan_on_start))


@priv_routes.post("/api/open")
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


@priv_routes.post("/api/book")
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

        title, author, section = (
            _clean_text(request.title),
            _clean_text(request.author),
            _clean_text(request.section),
        )

        # Форма присылает все три поля, даже если пользователь менял одно. Значение,
        # совпадающее с базовым, в overrides не пишем: иначе оно скопирует туда данные
        # из taxonomy.json и заморозит их — будущая перегенерация раскладки до карточки
        # уже не достучится, потому что COALESCE отдаст залипшую копию.
        title = title if title != base["title"] else None
        author = author if author != base["author"] else None
        section = section if section != base["section"] else None

        has_field_changes = any((title, author, section))

        conn.execute("BEGIN IMMEDIATE")
        try:
            if request.reset:
                conn.execute("DELETE FROM overrides WHERE key = ?", (request.key,))
                tags.replace_book_tags(conn, request.key, [])
                action = "reset"
            else:
                if has_field_changes:
                    conn.execute(
                        "INSERT INTO overrides(key, title, author, section, updated_at) "
                        "VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET "
                        "title=excluded.title, author=excluded.author, section=excluded.section, "
                        "updated_at=excluded.updated_at",
                        (request.key, title, author, section, time.time()),
                    )
                else:
                    conn.execute("DELETE FROM overrides WHERE key = ?", (request.key,))

                if request.tags is not None:
                    tags.replace_book_tags(conn, request.key, request.tags)
                    action = "saved"
                elif has_field_changes:
                    action = "saved"
                else:
                    action = "reset"
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return {"action": action, "key": request.key}


@priv_routes.post("/api/tags")
def api_create_tag(request: TagCreateRequest) -> dict:
    with closing(connect()) as conn:
        return tags.create_tag(conn, request.name, request.kind, request.description)


@priv_routes.put("/api/tags/{tag_id}")
def api_update_tag(tag_id: int, request: TagUpdateRequest) -> dict:
    with closing(connect()) as conn:
        description = (
            request.description
            if "description" in request.model_fields_set
            else tags.DESCRIPTION_UNSET
        )
        return tags.update_tag(conn, tag_id, request.name, request.kind, description)


@priv_routes.post("/api/tags/{tag_id}/aliases")
def api_add_alias(tag_id: int, request: AliasRequest) -> dict:
    with closing(connect()) as conn:
        return tags.add_alias(conn, tag_id, request.alias)


@priv_routes.delete("/api/tags/{tag_id}/aliases")
def api_remove_alias(tag_id: int, alias: str) -> dict:
    with closing(connect()) as conn:
        return tags.remove_alias(conn, tag_id, alias)


@priv_routes.delete("/api/tags/{tag_id}")
def api_delete_tag(tag_id: int) -> dict:
    with closing(connect()) as conn:
        return tags.delete_tag(conn, tag_id)


@priv_routes.post("/api/tags/merge")
def api_merge_tags(request: MergeRequest) -> dict:
    with closing(connect()) as conn:
        return tags.merge_tags(conn, request.source, request.target)


@priv_routes.put("/api/book/{key:path}/tags")
def api_set_book_tags(key: str, request: BookTagsRequest) -> dict:
    with closing(connect()) as conn:
        return tags.set_book_tags(conn, key, request.tags)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(get_settings().static_dir / "index.html")


@app.get("/sw.js")
def service_worker() -> FileResponse:
    return FileResponse(
        get_settings().static_dir / "sw.js",
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


app.include_router(priv_routes)
app.mount("/static", StaticFiles(directory=get_settings().static_dir), name="static")
