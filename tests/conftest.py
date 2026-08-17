"""Общие фикстуры. Настоящая библиотека в тестах не участвует.

Все тесты работают на временном корне: библиотека пользователя read-only
(активные раздачи qBittorrent), трогать её из тестов нельзя даже на чтение
структуры — иначе тесты начнут зависеть от того, что там сегодня лежит.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from booklib.config.settings import get_settings
from booklib.db import connect

MINIMAL_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
)


@pytest.fixture(autouse=True)
def isolated_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Изолировать настройки: свой корень, свой кэш, свой config."""
    monkeypatch.setenv("BOOKLIB_ROOT", str(tmp_path / "library"))
    monkeypatch.setenv("BOOKLIB_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("BOOKLIB_CONFIG_DIR", str(tmp_path / "config"))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def library(tmp_path: Path) -> Path:
    root = tmp_path / "library"
    root.mkdir(parents=True, exist_ok=True)
    return root


@pytest.fixture
def db(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    conn = connect(tmp_path / "cache" / "library.db")
    yield conn
    conn.close()


def make_book(root: Path, relative: str, content: bytes = MINIMAL_PDF) -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path
