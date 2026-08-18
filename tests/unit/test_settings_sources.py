"""Рантайм-конфиг: приоритет над env, whitelist, обновление кэша настроек."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from booklib.config.settings import field_source, get_settings, write_runtime_config


def _write_config(cache: Path, **fields: object) -> Path:
    path = cache / "config.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fields), encoding="utf-8")
    return path


def test_config_overrides_env(tmp_path: Path) -> None:
    """UI должен побеждать окружение, иначе выбранный в витрине корень «не работает»."""
    _write_config(tmp_path / "cache", root=str(tmp_path / "from-config"))

    get_settings.cache_clear()
    settings = get_settings()

    assert str(settings.root) == str(tmp_path / "from-config")
    assert field_source("root") == "config"
    # cache_dir продолжает браться из env, а не из файла
    assert settings.cache_dir == tmp_path / "cache"


def test_cache_dir_from_file_is_ignored(tmp_path: Path) -> None:
    """cache_dir из config.json не читается: файл лежит внутри cache_dir — цикл."""
    _write_config(tmp_path / "cache", cache_dir=str(tmp_path / "другой-кэш"))

    get_settings.cache_clear()

    assert get_settings().cache_dir == tmp_path / "cache"


def test_fields_outside_whitelist_are_ignored(tmp_path: Path) -> None:
    _write_config(tmp_path / "cache", root=str(tmp_path / "lib"), host="0.0.0.0")

    get_settings.cache_clear()
    settings = get_settings()

    assert str(settings.root) == str(tmp_path / "lib")
    assert settings.host == "127.0.0.1"


def test_cache_clear_picks_up_file_change(tmp_path: Path) -> None:
    cfg = _write_config(tmp_path / "cache", root=str(tmp_path / "one"))
    get_settings.cache_clear()
    assert str(get_settings().root) == str(tmp_path / "one")

    cfg.write_text(json.dumps({"root": str(tmp_path / "two")}), encoding="utf-8")
    get_settings.cache_clear()

    assert str(get_settings().root) == str(tmp_path / "two")


def test_write_runtime_config_roundtrip(tmp_path: Path) -> None:
    get_settings.cache_clear()
    write_runtime_config(root=str(tmp_path / "lib"), scan_on_start=False)

    settings = get_settings()

    assert str(settings.root) == str(tmp_path / "lib")
    assert settings.scan_on_start is False
    assert field_source("root") == "config"


def test_write_unknown_field_raises(tmp_path: Path) -> None:
    get_settings.cache_clear()
    with pytest.raises(ValueError):
        write_runtime_config(port=9999)


def test_broken_config_file_falls_back_to_env(tmp_path: Path) -> None:
    """Битый JSON из ручной правки не должен ронять приложение."""
    (tmp_path / "cache").mkdir(parents=True)
    (tmp_path / "cache" / "config.json").write_text("{oops", encoding="utf-8")

    get_settings.cache_clear()

    assert str(get_settings().root) == str(tmp_path / "library")  # BOOKLIB_ROOT из conftest
    assert field_source("root") == "env"


def test_env_source_is_reported(tmp_path: Path) -> None:
    get_settings.cache_clear()
    assert field_source("root") == "env"


def test_default_source_when_not_configured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("BOOKLIB_ROOT")
    get_settings.cache_clear()
    assert field_source("root") == "default"


def test_slot_dir_normalizes_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Два написания одного каталога (trailing slash, симлинк) — один слот."""
    library = tmp_path / "library"
    library.mkdir()
    link = tmp_path / "link"
    link.symlink_to(library)

    monkeypatch.setenv("BOOKLIB_ROOT", str(library) + "/")
    get_settings.cache_clear()
    slot_with_slash = get_settings().slot_dir

    monkeypatch.setenv("BOOKLIB_ROOT", str(link))
    get_settings.cache_clear()
    slot_via_link = get_settings().slot_dir

    assert slot_with_slash == slot_via_link
