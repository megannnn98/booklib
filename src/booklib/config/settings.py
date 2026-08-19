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

from pydantic import Field, field_validator
from pydantic.fields import FieldInfo
from pydantic_settings import (
    BaseSettings,
    DotEnvSettingsSource,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    SettingsError,
)

PACKAGE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PACKAGE_DIR.parent.parent

# Дефолты конфигурации, попадающие в wheel: rules.json лежит здесь, а не в
# config_dir, иначе установка колесом молча осталась бы без правил.
PACKAGE_CONFIG_DIR = PACKAGE_DIR / "config"

# Куда смотреть за конфигами, когда работаем не из чекаута репозитория.
CONFIG_FALLBACK_DIR = Path.home() / ".config" / "booklib"

RUNTIME_CONFIG_NAME = "config.json"

# Дефолт cache_dir в одном месте: его знают и поле Settings.cache_dir, и поиск
# рантайм-конфига (который не может спросить настройки — он их и формирует).
DEFAULT_CACHE_DIR = Path.home() / ".cache" / "booklib"

# Поля, которые можно менять из UI. cache_dir из файла принципиально не читается:
# файл лежит внутри cache_dir, чтение привело бы к циклу.
RUNTIME_CONFIG_FIELDS = ("root", "scan_on_start")


def _default_config_dir() -> Path:
    """config_dir: каталог чекаута, если запущены из репозитория, иначе ~/.config/booklib.

    REPO_DIR выводится из расположения пакета, поэтому при установке колесом он
    указывает внутрь site-packages — каталога, которого нет и в котором
    пользователю нечего править.
    """
    repo_config = REPO_DIR / "config"
    if repo_config.is_dir():
        return repo_config
    return CONFIG_FALLBACK_DIR


def _read_runtime_config(path: Path) -> dict[str, Any]:
    """whitelist-поля из JSON-файла. Битый файл — пустой словарь.

    Приложение не должно отваливаться из-за ручной правки конфига, поэтому
    читаем терпимо; whitelist — чтобы случайное поле не превратилось в
    настройку. Общий helper для чтения и для read-modify-write.
    """
    if not path.exists():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(loaded, dict):
        return {}
    return {k: v for k, v in loaded.items() if k in RUNTIME_CONFIG_FIELDS}


def _dotenv_data() -> dict[str, Any]:
    """Поля из .env глазами самого pydantic-settings.

    Свой парсер .env был бы четвёртой реализацией одного и того же (и врал бы
    на кавычках, export, multiline). Источник читает env_file из model_config,
    так что справка о источниках не расходится с тем, что реально применилось.
    """
    try:
        return dict(DotEnvSettingsSource(Settings)())
    except (OSError, SettingsError, UnicodeDecodeError):
        # Битый .env не должен ронять справку об источниках: Settings() на таком
        # файле упадёт всё равно, но field_source зовётся ещё и из doctor.
        return {}


def _config_cache_dir() -> Path:
    """cache_dir для поиска рантайм-конфига: env → .env → умолчание.

    Из settings.cache_dir его брать нельзя: файл лежит внутри cache_dir, и
    настройки как раз строятся из него — вышел бы цикл.
    """
    env = os.environ.get("BOOKLIB_CACHE_DIR")
    if env:
        return Path(env).expanduser()
    from_dotenv = _dotenv_data().get("cache_dir")
    if from_dotenv:
        return Path(str(from_dotenv)).expanduser()
    return DEFAULT_CACHE_DIR


def runtime_config_data() -> dict[str, Any]:
    """Актуальные whitelist-поля из cache_dir/config.json."""
    return _read_runtime_config(_config_cache_dir() / RUNTIME_CONFIG_NAME)


def field_source(field: str) -> str:
    """Откуда взято значение поля: config → env → env-file (.env) → default.

    Нужен для справки в UI/CLI: «почему сканируется не та папка» нельзя
    диагностировать, не зная, какой источник победил. Метки соответствуют
    порядку источников в settings_customise_sources.
    """
    if field in runtime_config_data():
        return "config"
    if f"BOOKLIB_{field.upper()}" in os.environ:
        return "env"
    if field in _dotenv_data():
        return "env-file"
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
    root: Path = Path.home() / "Books"
    cache_dir: Path = DEFAULT_CACHE_DIR
    config_dir: Path = Field(default_factory=_default_config_dir)

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

    @field_validator("root", "cache_dir", "config_dir", mode="before")
    @classmethod
    def _expand_user(cls, value: Any) -> Any:
        """Развернуть ~ в путях из env/.env/config.json.

        pydantic присваивает Path-полю значение из окружения дословно, поэтому
        BOOKLIB_CACHE_DIR=~/cache давал каталог с именем «~», а _config_cache_dir()
        (он ищет config.json) тильду разворачивал: запись из UI уходила в один
        файл, чтение — из другого, и выбранный корень «не липнул». То же с
        BOOKLIB_ROOT=~/Books — библиотека числилась несмонтированной.
        На абсолютном пути expanduser() — no-op.
        """
        if isinstance(value, str | Path):
            return Path(value).expanduser()
        return value

    @property
    def slot_dir(self) -> Path:
        """Слот состояния текущего корня: СУБД и обложки скоупятся по корню.

        Один и тот же относительный путь в двух библиотеках — это одна строка по
        PRIMARY KEY, поэтому сканировать другой корень в ту же СУБД нельзя.
        Имя слота — sha1 корня, внутри root.txt с литеральным путём для чтения.
        """
        resolved = str(self.root.expanduser().resolve())
        digest = hashlib.sha1(resolved.encode("utf-8")).hexdigest()[:12]
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

    def resolve_config_file(self, name: str) -> tuple[Path, str]:
        """(путь, источник) для файла конфигурации: оверрайд → пакетный дефолт.

        Один резолвер на все конфиги: у rules.json фолбэк на пакетный дефолт был,
        у taxonomy.json — нет, и разница ничем не объяснялась. Когда файла нет
        нигде, возвращаем путь в config_dir: именно туда его и надо положить,
        так что сообщение doctor остаётся действием, а не загадкой.
        """
        user = self.config_dir / name
        if user.exists():
            return user, "пользовательский"
        packaged = PACKAGE_CONFIG_DIR / name
        if packaged.exists():
            return packaged, "пакетный дефолт"
        return user, "нет файла"

    @property
    def taxonomy_path(self) -> Path:
        return self.resolve_config_file("taxonomy.json")[0]

    @property
    def rules_path(self) -> Path:
        return self.resolve_config_file("rules.json")[0]

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
        # Первый источник — наивысший приоритет. init_settings (программная
        # передача: Settings(root=...)) побеждает рантайм-конфиг из UI, потому
        # что это явный код, а не окружение; рантайм-конфиг — над env, чтобы
        # выбранный в витрине корень «работал», а не перебивался переменными.
        return (
            init_settings,
            _RuntimeConfigSource(settings_cls),
            env_settings,
            dotenv_settings,
            file_secret_settings,
        )


def write_runtime_config(root: str | None = None, scan_on_start: bool | None = None) -> None:
    """Атомарно записать рантайм-конфиг и сбросить кэш настроек.

    Параметры перечислены явно, а не **fields с рантайм-проверкой whitelist:
    опечатку в имени поля так ловит mypy на вызывающей стороне, а не ValueError
    в продакшне. None — «поле не меняем», поэтому scan_on_start=False пишется
    корректно. Записываются все переданные поля разом: полуприменённого
    конфига (корень новый, а флаг ещё старый) не бывает.

    Атомарность — «читатель видит старое или новое, никогда частичное»
    (mkstemp + os.replace). fsync намеренно нет: файл хранит выбор пользователя,
    и потеря последней записи при отключении питания допустима.
    """
    fields = {
        name: value
        for name, value in (("root", root), ("scan_on_start", scan_on_start))
        if value is not None
    }
    if not fields:
        return

    path = get_settings().runtime_config_path
    current = _read_runtime_config(path)
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
