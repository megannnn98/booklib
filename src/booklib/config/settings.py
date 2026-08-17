"""Настройки booklib (префикс переменных окружения BOOKLIB_).

Библиотека читается строго read-only, поэтому всё изменяемое состояние живёт
в cache_dir, а не рядом с книгами.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PACKAGE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PACKAGE_DIR.parent.parent


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
    def db_path(self) -> Path:
        return self.cache_dir / "library.db"

    @property
    def cover_dir(self) -> Path:
        return self.cache_dir / "covers"

    @property
    def taxonomy_path(self) -> Path:
        return self.config_dir / "taxonomy.json"

    @property
    def rules_path(self) -> Path:
        return self.config_dir / "rules.json"

    @property
    def static_dir(self) -> Path:
        return PACKAGE_DIR / "api" / "static"


@lru_cache
def get_settings() -> Settings:
    return Settings()
