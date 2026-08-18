"""Правила разделов находятся и при установке колесом.

Без пакетного дефолта `load_rules()` молча вернёт [] на машине без
config_dir — вся библиотека уедет в «Новое» без единой ошибки.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from booklib.config.settings import get_settings
from booklib.taxonomy import classify_new, load_rules

DATASHEET = "stm32-reference-manual.pdf"


def _point_config_dir_at(monkeypatch: pytest.MonkeyPatch, path: Path) -> None:
    monkeypatch.setenv("BOOKLIB_CONFIG_DIR", str(path))
    get_settings.cache_clear()


def test_package_default_when_config_dir_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Установка колесом: config_dir не существует, правила — пакетный дефолт.

    Мутация: убрать фолбэк на package_rules_path — этот тест падает
    (правил нет, даташит классифицируется в «Новое»).
    """
    missing = tmp_path / "no-such-config"
    _point_config_dir_at(monkeypatch, missing)
    assert not missing.exists()

    rules, default = load_rules()
    assert rules, "пакетный дефолт не найден — вся библиотека уедет в «Новое»"
    assert classify_new(DATASHEET) != ("Новое", "default")


def test_user_rules_override_package(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Пользовательский config_dir/rules.json перекрывает пакетный."""
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True)
    (config_dir / "rules.json").write_text(
        json.dumps({"default": "Мои книги", "rules": []}), encoding="utf-8"
    )
    _point_config_dir_at(monkeypatch, config_dir)

    assert get_settings().rules_path == config_dir / "rules.json"
    rules, default = load_rules()
    assert rules == []
    assert default == "Мои книги"
    assert classify_new(DATASHEET) == ("Мои книги", "default")


def test_package_rules_file_exists() -> None:
    """Файл лежит внутри пакета — только так он попадёт в wheel."""
    path = get_settings().package_rules_path
    assert path.exists(), f"пакетный файл правил не найден: {path}"
