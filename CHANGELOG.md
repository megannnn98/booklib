# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/).

## [Unreleased]

### Added
- Структура проекта по образцу ebnv: пакет `src/booklib`, `config/`, `docs/`,
  `scripts/`, `tests/{unit,integration}`.
- `pyproject.toml` (hatchling), настройки через `pydantic-settings` с префиксом `BOOKLIB_`.
- CLI на Typer: `booklib scan | covers | sections | classify | open | doctor | serve`.
- Ruff (format + lint), mypy, pytest; pre-commit с ruff и базовыми хуками; CI на GitHub Actions.
- Тесты на инварианты: группировка карточек, нормализация имён, guard от
  неподключённого диска, guard от выхода за пределы библиотеки, правила разделов,
  приоритет overrides над таксономией.

### Changed
- Модули больше не читают окружение напрямую — всё через `booklib.config.settings`.
- `taxonomy.json` и `rules.json` переехали в `config/`.
- `config/taxonomy.json` и `scripts/build_taxonomy.py` не коммитятся: это опись
  личной библиотеки. В репозитории — `config/taxonomy.example.json` и `scripts/README.md`.
- Веб-приложение переехало в `booklib.api.app`, статика — в `booklib/api/static`.

## [0.1.0] — 2026-08-17

### Added
- Первая рабочая версия: сканер, обложки, виртуальные разделы, витрина,
  открытие папки в nemo через DBus, правки карточек, systemd --user юнит.
