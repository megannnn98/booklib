"""Рантайм-конфиг: приоритет над env, whitelist, обновление кэша настроек."""

from __future__ import annotations

import inspect
import json
from pathlib import Path

import pytest

from booklib.config import settings as settings_module
from booklib.config.settings import (
    RUNTIME_CONFIG_FIELDS,
    Settings,
    field_source,
    get_settings,
    write_runtime_config,
)


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


def test_programmatic_root_wins_over_runtime_config(tmp_path: Path) -> None:
    """F5: Settings(root=...) — программная передача, а не env, и должна побеждать.

    Раньше _RuntimeConfigSource стоял выше init_settings, и явный Settings(root=...)
    молча игнорировался, если существовал config.json. Мутация: убрать init_settings
    из списка источников (или поставить его ниже конфига) — это построение
    вернуло бы корень из файла, и тест упал бы.
    """
    _write_config(tmp_path / "cache", root=str(tmp_path / "from-config"))
    forced = Settings(root=tmp_path / "forced")

    assert str(forced.root) == str(tmp_path / "forced")


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


def test_writer_parameters_match_whitelist() -> None:
    """Сигнатура write_runtime_config = whitelist рантайм-конфига.

    Раньше whitelist проверялся в рантайме (**fields + ValueError). Теперь поля
    перечислены явно, и опечатку ловит mypy; этот тест держит два списка от
    расхождения — иначе новое поле писалось бы, но не читалось.
    """
    params = set(inspect.signature(write_runtime_config).parameters)
    assert params == set(RUNTIME_CONFIG_FIELDS)


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
    # chdir в tmp_path: .env читается относительно cwd, и локальный .env
    # разработчика не должен превращать "default" в "env-file".
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("BOOKLIB_ROOT")
    get_settings.cache_clear()
    assert field_source("root") == "default"


def test_env_file_source_is_reported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """.env — отдельный источник, а не «env»: иначе справка врёт, где искать значение."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("BOOKLIB_ROOT")
    (tmp_path / ".env").write_text(f"BOOKLIB_ROOT={tmp_path / 'from-dotenv'}\n", encoding="utf-8")

    get_settings.cache_clear()

    assert str(get_settings().root) == str(tmp_path / "from-dotenv")
    assert field_source("root") == "env-file"


def test_runtime_config_found_via_dotenv_cache_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """cache_dir из .env — рантайм-конфиг ищется там же, где его пишут.

    Раньше поиск config.json знал только BOOKLIB_CACHE_DIR и умолчание, поэтому
    при cache_dir из .env настройки читали конфиг не оттуда, куда указывал
    settings.cache_dir: запись из UI попадала в один файл, чтение — в другой.
    """
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("BOOKLIB_CACHE_DIR")
    cache = tmp_path / "dotenv-cache"
    (tmp_path / ".env").write_text(f"BOOKLIB_CACHE_DIR={cache}\n", encoding="utf-8")
    _write_config(cache, root=str(tmp_path / "from-config"))

    get_settings.cache_clear()
    settings = get_settings()

    assert settings.cache_dir == cache
    assert str(settings.root) == str(tmp_path / "from-config")
    assert field_source("root") == "config"


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


def test_paths_from_env_expand_tilde(monkeypatch: pytest.MonkeyPatch) -> None:
    """~ в путях разворачивается в модели, иначе чтение и запись конфига разъедутся.

    pydantic присваивает Path-полю значение из env дословно, а _config_cache_dir()
    (поиск config.json) тильду разворачивал: запись из UI уходила в «~/cache»,
    чтение — из «$HOME/cache». Мутация: убрать валидатор _expand_user — тест падает.
    """
    monkeypatch.setenv("BOOKLIB_CACHE_DIR", "~/tilde-cache")
    monkeypatch.setenv("BOOKLIB_ROOT", "~/tilde-books")
    get_settings.cache_clear()
    settings = get_settings()

    assert settings.cache_dir == Path.home() / "tilde-cache"
    assert settings.root == Path.home() / "tilde-books"
    assert settings.cache_dir == settings_module._config_cache_dir()
    assert settings.runtime_config_path == Path.home() / "tilde-cache" / "config.json"
