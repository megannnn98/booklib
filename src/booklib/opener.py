#!/usr/bin/env python3
"""Открытие папки с книгой в файловом менеджере хоста.

Основной путь — DBus-метод org.freedesktop.FileManager1.ShowItems: он открывает
папку И подсвечивает нужный файл. Это принципиально: в PLPM 62 файла в одной
папке, в programming-embedded — 185, и без подсветки книгу пришлось бы искать глазами.

Запасной путь — xdg-open по директории, если FileManager1 на шине не отвечает.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
from pathlib import Path
from urllib.parse import quote

from booklib.scanner import connect, library_root

DBUS_DEST = "org.freedesktop.FileManager1"
DBUS_PATH = "/org/freedesktop/FileManager1"
DBUS_METHOD = "org.freedesktop.FileManager1.ShowItems"
CALL_TIMEOUT_S = 10


class OpenError(RuntimeError):
    """Не удалось открыть — с человекочитаемой причиной."""


class OutsideLibrary(OpenError):
    """Путь ведёт за пределы библиотеки. Отдаём 403, а не 500."""


class BookNotFound(OpenError):
    """Ключа нет в каталоге — 404."""


class TargetMissing(OpenError):
    """Файл на месте не найден, обычно диск отключён — 503."""


def session_bus_env() -> dict[str, str]:
    """Окружение с гарантированным адресом сессионной шины.

    Под systemd --user переменная обычно есть, но если сервис запустили из
    урезанного окружения — восстанавливаем стандартный путь /run/user/<uid>/bus.
    """
    env = dict(os.environ)
    if not env.get("DBUS_SESSION_BUS_ADDRESS"):
        socket = Path(f"/run/user/{os.getuid()}/bus")
        if socket.exists():
            env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={socket}"
    return env


def resolve_target(
    key: str,
    conn: sqlite3.Connection | None = None,
    root: Path | None = None,
) -> Path:
    """Найти файл книги по ключу и убедиться, что он внутри библиотеки."""
    own_conn = conn is None
    conn = conn or connect()
    try:
        row = conn.execute("SELECT primary_file FROM books WHERE key = ?", (key,)).fetchone()
    finally:
        if own_conn:
            conn.close()
    if row is None:
        raise BookNotFound(f"книга не найдена в каталоге: {key}")

    base = library_root(root)
    resolved_root = base.resolve()
    target = (base / row["primary_file"]).resolve()
    if not target.is_relative_to(resolved_root):
        raise OutsideLibrary(f"путь вне библиотеки: {target}")
    if not target.exists():
        raise TargetMissing(f"файл недоступен (диск отключён?): {target}")
    return target


def _file_uri(path: Path) -> str:
    uri = "file://" + quote(str(path))
    if "'" in uri or "\\" in uri:  # в GVariant-литерал ниже такое попасть не должно
        raise OpenError(f"недопустимый символ в URI: {uri}")
    return uri


def show_items(path: Path) -> str:
    """Открыть файловый менеджер с выделенным файлом. Возвращает использованный способ."""
    result = subprocess.run(
        [
            "gdbus",
            "call",
            "--session",
            "--dest",
            DBUS_DEST,
            "--object-path",
            DBUS_PATH,
            "--method",
            DBUS_METHOD,
            f"['{_file_uri(path)}']",
            "",
        ],
        capture_output=True,
        timeout=CALL_TIMEOUT_S,
        env=session_bus_env(),
        check=False,
    )
    if result.returncode == 0:
        return "dbus"

    dbus_error = result.stderr.decode("utf-8", "replace").strip()
    fallback = subprocess.run(
        ["xdg-open", str(path.parent)],
        capture_output=True,
        timeout=CALL_TIMEOUT_S,
        env=session_bus_env(),
        check=False,
    )
    if fallback.returncode == 0:
        return "xdg-open"

    raise OpenError(
        f"DBus: {dbus_error or 'ошибка'}; "
        f"xdg-open: {fallback.stderr.decode('utf-8', 'replace').strip() or 'ошибка'}"
    )


def open_book(
    key: str,
    conn: sqlite3.Connection | None = None,
    root: Path | None = None,
) -> dict[str, str]:
    target = resolve_target(key, conn, root)
    method = show_items(target)
    return {
        "opened": str(target.relative_to(library_root(root).resolve())),
        "dir": str(target.parent),
        "method": method,
    }
