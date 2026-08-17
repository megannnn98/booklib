"""Исключения, общие для обхода библиотеки и записи каталога."""

from __future__ import annotations


class LibraryUnavailable(RuntimeError):
    """Корень библиотеки не смонтирован или пуст — каталог трогать нельзя."""
