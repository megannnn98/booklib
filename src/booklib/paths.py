"""Пути внутри библиотеки. Единственное место, где берётся корень из настроек."""

from __future__ import annotations

from pathlib import Path

from booklib.config.settings import get_settings


def library_root() -> Path:
    return get_settings().root


def relative_to_root(path: Path) -> str:
    return str(path.relative_to(library_root()))
