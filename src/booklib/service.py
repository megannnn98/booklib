"""Операции по сценарию «обновить каталог / сменить корень».

Единственное место, где защищён сканер: и HTTP-слой, и CLI делегируют сюда
orchestration, а не продублируют его. До этого сценарий «применить корень»
(validate → write_runtime_config → rescan) жил в двух копиях — в api.app и
cli.app, и в CLI write_runtime_config вызывался вне замка рескана (тот самый
дефект, который в API-ветке чинили отдельным коммитом).
"""

from __future__ import annotations

import threading
import time

from booklib import covers
from booklib.config.settings import write_runtime_config
from booklib.db import connect, init_slot_marker
from booklib.grouping import collect_groups
from booklib.rootcheck import validate_root
from booklib.scanner import sync
from booklib.taxonomy import apply as apply_sections

_RESCAN_LOCK = threading.Lock()


def _rescan() -> dict:
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


def rescan() -> dict:
    """Полный цикл обновления: скан → разделы → недостающие обложки.

    Под замком: роуты синхронные и выполняются в пуле потоков uvicorn, поэтому
    двойной клик по «Обновить» или вторая вкладка запускали два скана разом —
    два писателя в СУБД и две генерации одной обложки. Один и тот же замок
    держат и HTTP /api/rescan, и CLI `booklib scan`/`config --root`.

    Замок внутрипроцессный: `booklib config --root` при живом сервисе — это два
    процесса, и там мы полагаемся на сам SQLite (WAL + timeout BUSY_TIMEOUT_S).
    Слоты изолированы по корню, поэтому худшее — «database is locked» на
    длинной генерации обложек, а не порча данных.
    """
    with _RESCAN_LOCK:
        return _rescan()


def apply_root(value: str, scan_on_start: bool | None = None) -> dict:
    """Провалидировать, применить корень и пересканировать — атомарно
    относительно других сканов.

    scan_on_start (если передан) пишется тем же вызовом: два раздельных write
    оставляли бы конфиг полуприменённым и один из них — вне замка.

    Конфиг пишется до скана: выбор уже провалидирован, а LibraryUnavailable
    объясняет, почему каталог пуст. root.txt нового слота пишем сразу после
    конфига — legacy-миграцию тут намеренно НЕ вызываем (см. db.init_state):
    переключение корня не должно утащить состояние старого корня в чужой слот.
    """
    path = validate_root(value)
    with _RESCAN_LOCK:
        write_runtime_config(root=str(path), scan_on_start=scan_on_start)
        init_slot_marker()
        return _rescan()
