"""Настройки booklib (префикс переменных окружения BOOKLIB_).

Библиотека читается строго read-only, поэтому всё изменяемое состояние живёт
в cache_dir, а не рядом с книгами.

Приоритет источников: cache_dir/config.json (рантайм-конфиг из UI) →
переменные окружения BOOKLIB_* → .env → значения по умолчанию.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic.fields import FieldInfo
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

PACKAGE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PACKAGE_DIR.parent.parent

RUNTIME_CONFIG_NAME = "config.json"

# Поля, которые можно менять из UI. cache_dir из файла принципиально не читается:
# файл лежит внутри cache_dir, чтение привело бы к циклу.
RUNTIME_CONFIG_FIELDS = ("root", "scan_on_start")


def runtime_config_data() -> dict[str, Any]:
    """Актуальные whitelist-поля из cache_dir/config.json.

    Путь выводится из BOOKLIB_CACHE_DIR (или умолчания) напрямую, а не из
    settings.cache_dir — иначе функция зависела бы от самого файла. Битый JSON —
    пустой словарь: приложение не должно отваливаться из-за ручной правки файла.
    """
    env = os.environ.get("BOOKLIB_CACHE_DIR")
    cache_dir = Path(env) if env else Path.home() / ".cache" / "booklib"
    path = cache_dir / RUNTIME_CONFIG_NAME
    if not path.exists():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(loaded, dict):
        return {}
    return {k: v for k, v in loaded.items() if k in RUNTIME_CONFIG_FIELDS}


def _dotenv_value(name: str) -> str | None:
    """Значение переменной из .env в текущем каталоге — как читает pydantic-settings."""
    env_file = Path(".env")
    if not env_file.exists():
        return None
    try:
        lines = env_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip() == name:
            return value.strip().strip('"').strip("'")
    return None


def field_source(field: str) -> str:
    """Откуда берётся значение поля: config → env → env-file (.env) → default.

    Нужен для справки в UI/CLI: «почему сканируется не та папка» нельзя
    диагностировать, не зная, какой источник победил.
    """
    if field in runtime_config_data():
        return "config"
    env_name = f"BOOKLIB_{field.upper()}"
    if env_name in os.environ or _dotenv_value(env_name) is not None:
        return "env"
    return "default"


class _RuntimeConfigSource(PydanticBaseSettingsSource):
    """cache_dir/config.json с приоритетом выше env: UI должен побеждать окружение."""

    def __init__(self, settings_cls: type[BaseSettings]) -> None:
        super().__init__(settings_cls)
        self._data = runtime_config_data()

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        if field_name in self._data:
            return self._data[field_name], field_name, False
        return None, field_name, False

    def __call__(self) -> dict[str, Any]:
        return dict(self._data)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BOOKLIB_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Библиотека и состояние
    root: Path = Path("/run/media/b/DOWNLOADS/books")
    cache_dir: Path = Path.home() / ".cache" / "booklib"
    config_dir: Path = REPO_DIR / "config"

    # HTTP. Менять host на 0.0.0.0 нельзя: /api/open запускает процессы в сессии.
    host: str = "127.0.0.1"
    port: int = 8765
    scan_on_start: bool = True

    # Превью
    cover_width: int = 400
    cover_max_height: int = 700
    cover_quality: int = 82
    cover_workers: int = 4
    render_timeout_s: int = 60

    @property
    def slot_dir(self) -> Path:
        """Слот состояния текущего корня: СУБД и обложки скоупятся по корню.

        Один и тот же относительный путь в двух библиотеках — это одна строка по
        PRIMARY KEY, поэтому сканировать другой корень в ту же СУБД нельзя.
        Имя слота — sha1 корня, внутри root.txt с литеральным путём для чтения.
        """
        digest = hashlib.sha1(str(self.root).encode("utf-8")).hexdigest()[:12]
        return self.cache_dir / "roots" / digest

    @property
    def db_path(self) -> Path:
        return self.slot_dir / "library.db"

    @property
    def cover_dir(self) -> Path:
        return self.slot_dir / "covers"

    @property
    def runtime_config_path(self) -> Path:
        return self.cache_dir / RUNTIME_CONFIG_NAME

    @property
    def taxonomy_path(self) -> Path:
        return self.config_dir / "taxonomy.json"

    @property
    def rules_path(self) -> Path:
        return self.config_dir / "rules.json"

    @property
    def static_dir(self) -> Path:
        return PACKAGE_DIR / "api" / "static"

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # Первый источник — наивысший приоритет: UI должен побеждать env,
        # иначе выбранный в витрине корень «не работает».
        return (
            _RuntimeConfigSource(settings_cls),
            init_settings,
            env_settings,
            dotenv_settings,
            file_secret_settings,
        )


def write_runtime_config(**fields: object) -> None:
    """Атомарно записать рантайм-конфиг и сбросить кэш настроек.

    Неизвестные поля — ошибка: whitelist держится строгим, чтобы случайная
    опечатка не превратилась в молча проигнорированную настройку.
    """
    unknown = set(fields) - set(RUNTIME_CONFIG_FIELDS)
    if unknown:
        raise ValueError(f"неизвестные поля рантайм-конфига: {sorted(unknown)}")

    settings = get_settings()
    path = settings.runtime_config_path
    current: dict[str, Any] = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            loaded = {}
        if isinstance(loaded, dict):
            current = {k: v for k, v in loaded.items() if k in RUNTIME_CONFIG_FIELDS}
    current.update(fields)
    current = {k: (str(v) if isinstance(v, Path) else v) for k, v in current.items()}

    path.parent.mkdir(parents=True, exist_ok=True)
    # Уникальный временный файл рядом с целевым: фиксированное имя значило бы
    # гонку при параллельных записях (тот же приём, что в covers._save).
    handle, tmp_name = tempfile.mkstemp(suffix=".json", dir=path.parent)
    os.close(handle)
    tmp = Path(tmp_name)
    try:
        tmp.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    get_settings.cache_clear()


@lru_cache
def get_settings() -> Settings:
    return Settings()
