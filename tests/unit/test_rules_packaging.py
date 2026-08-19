"""Правила разделов находятся и при установке колесом.

Без пакетного дефолта `load_rules()` молча вернёт [] на машине без
config_dir — вся библиотека уедет в «Новое» без единой ошибки.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from booklib.config import settings as settings_module
from booklib.config.settings import PACKAGE_CONFIG_DIR, get_settings
from booklib.taxonomy import classify_new, load_rules

DATASHEET = "stm32-reference-manual.pdf"


def _point_config_dir_at(monkeypatch: pytest.MonkeyPatch, path: Path) -> None:
    monkeypatch.setenv("BOOKLIB_CONFIG_DIR", str(path))
    get_settings.cache_clear()


def test_package_default_when_config_dir_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Установка колесом: config_dir не существует, правила — пакетный дефолт.

    Мутация: убрать фолбэк на PACKAGE_CONFIG_DIR в resolve_config_file — тест падает
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
    path = PACKAGE_CONFIG_DIR / "rules.json"
    assert path.exists(), f"пакетный файл правил не найден: {path}"


def test_resolve_config_file_reports_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Один резолвер на все конфиги: три исхода различимы по метке источника."""
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True)
    (config_dir / "taxonomy.json").write_text('{"sections": [], "books": {}}', encoding="utf-8")
    _point_config_dir_at(monkeypatch, config_dir)
    settings = get_settings()

    assert settings.resolve_config_file("taxonomy.json") == (
        config_dir / "taxonomy.json",
        "пользовательский",
    )
    assert settings.resolve_config_file("rules.json") == (
        PACKAGE_CONFIG_DIR / "rules.json",
        "пакетный дефолт",
    )
    # Нет нигде — путь указывает туда, куда файл надо положить, а не в пакет:
    # иначе строка doctor не подсказывает действие.
    assert settings.resolve_config_file("нет-такого.json") == (
        config_dir / "нет-такого.json",
        "нет файла",
    )


def test_config_dir_default_falls_back_outside_checkout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """При установке колесом REPO_DIR указывает в site-packages — берём ~/.config/booklib.

    Мутация: вернуть безусловный REPO_DIR / "config" — на wheel-установке
    config_dir указывал бы внутрь пакета, и taxonomy.json было бы некуда положить.
    """
    monkeypatch.setattr(settings_module, "REPO_DIR", tmp_path / "no-checkout")
    assert settings_module._default_config_dir() == settings_module.CONFIG_FALLBACK_DIR

    (tmp_path / "checkout" / "config").mkdir(parents=True)
    monkeypatch.setattr(settings_module, "REPO_DIR", tmp_path / "checkout")
    assert settings_module._default_config_dir() == tmp_path / "checkout" / "config"
