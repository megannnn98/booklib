# Архитектура booklib

## Слои

```
booklib.config.settings   настройки: init → config.json → env BOOKLIB_* → .env → умолчания
booklib.rootcheck         валидация и предпросмотр нового корня
booklib.tools             REQUIRED_TOOLS (общий для cli и api)
booklib.errors            LibraryUnavailable — общее исключение обхода и записи
booklib.paths             library_root / relative_to_root
booklib.db                connect()/connect_at(): схема, миграции, WAL, pylower+unicode_ci;
                          init_state() — миграция legacy и root.txt один раз на старте
booklib.service           rescan() и apply_root(): _RESCAN_LOCK, общий для api и cli
booklib.meta              нормализация имён файлов, эвристики названия/автора/года
booklib.grouping          обход дерева → карточки (BookGroup) → сводка обхода
booklib.scanner           инкрементальный диф карточек → SQLite
booklib.covers            превью: pdftocairo / ddjvu+Pillow / zip(epub) / base64(fb2)
booklib.taxonomy          разделы: overrides → taxonomy.json → rules.json → «Новое»
booklib.opener            DBus FileManager1.ShowItems, запасной xdg-open
booklib.api.app           FastAPI + статика витрины
booklib.cli.app           Typer CLI, точка входа `booklib`
scripts/build_taxonomy.py разовая раскладка библиотеки → config/taxonomy.json
```

Зависимости идут строго вниз: (`cli`, `api`) → `service` → (`scanner`, `covers`,
`taxonomy`, `opener`, `rootcheck`) → `grouping` → (`meta`, `paths`, `errors`) →
`settings`. Обратных импортов нет. `rootcheck` (как и `grouping`) читает расширения
`BOOK_EXTS`/`AUDIO_EXTS` из `grouping` — поэтому он стоит между `service` и
`grouping`. `tools` — константа без зависимостей; её импортируют и `cli`, и `api`.

`service` появился, чтобы сценарии не жили в HTTP-слое: раньше `cli` импортировал
`rescan` из `api.app`, а «применить корень» существовало в двух копиях, которые
успели разойтись (в CLI запись конфига шла вне замка). Теперь `apply_root(root,
scan_on_start)` — единственная реализация: валидация → один атомарный write
конфига → `root.txt` нового слота → рескан, всё под `_RESCAN_LOCK`. `api.app`
держит только HTTP-обвязку и два `exception_handler` (`LibraryUnavailable` → 503,
`InvalidRoot` → 400). `serve` поднимает uvicorn, поэтому `cli` → `api` остаётся,
но уже не ради скана.

`db` стоит сбоку от этой цепочки: он зависит только от `settings`, а соединение
получают напрямую `covers`, `opener`, `api`, `cli`, `service` и `scripts/`. Сам
`scanner` его не импортирует — `sync(conn, ...)` принимает готовое соединение
параметром.

`connect()` — единственная фабрика соединений в продакшне (слот текущего корня);
`connect_at(path)` нужен тестам и разбору legacy-состояния. Обе регистрируют
`pylower` и коллацию `unicode_ci`, поэтому SQL с ними корректен на любом
соединении, а не только на api-шном. Побочных эффектов на этом пути нет:
подготовку слота делает `init_state()` на старте процесса.

Обход дерева (`grouping`) и запись в каталог (`scanner`) разделены намеренно:
`collect_groups` только читает диск и не знает про SQLite, `sync` только пишет
диф и не знает про `os.walk`.

## Хранилище

| Что | Где | Почему |
|---|---|---|
| Книги | `BOOKLIB_ROOT` | read-only, активные раздачи qBittorrent |
| Слот состояния | `~/.cache/booklib/roots/<sha1(root)[:12]>/` | СУБД и обложки скоупятся по корню; внутри `root.txt` |
| Каталог | `~/.cache/booklib/roots/<sha1(root)[:12]>/library.db` | внешний диск может отвалиться; смена корня — свой слот |
| Превью | `~/.cache/booklib/roots/<sha1(root)[:12]>/covers/<sha1>.jpg` | 12 МБ, восстановимо из книг |
| Рантайм-конфиг | `~/.cache/booklib/config.json` | корень/scan_on_start из UI, перекрывает env |
| Раскладка | `config/taxonomy.json` | НЕ в git — опись личной библиотеки |
| Правила | `src/booklib/config/rules.json` (пакетный дефолт, в git), оверрайд — `config/rules.json` | правила должны работать и при установке колесом |
| Резолв конфигов | `Settings.resolve_config_file(name)` → (путь, источник) | один путь для taxonomy и rules: оверрайд → пакетный дефолт → «нет файла» |
| `config_dir` по умолчанию | каталог чекаута, иначе `~/.config/booklib` | в wheel `REPO_DIR` указывает внутрь site-packages |
| Ручные правки | таблица `overrides` | переживают рескан и смену taxonomy |

## Модель карточки

Карточка = файлы в одной папке с общим basename после нормализации (снимаются
`.a4`/`.a6` и машинные хвосты `_p117_1`, `_v3`). Одна книга в четырёх форматах —
одна карточка; шесть томов Михайловского — шесть карточек.

Ключ карточки: `относительный_путь_папки/нормализованный_basename`. К нему
привязаны файл обложки (sha1 ключа) и строка в `overrides`.

Порядок форматов различается по назначению:

- **primary_file** (что выделять в nemo): pdf → djvu → epub → fb2 → rtf;
- **источник обложки**: epub → fb2 → pdf → djvu (в epub лежит настоящая обложка,
  а первая страница PDF часто оказывается схемой или пустым титулом).

## Инварианты, закрытые тестами

| Инвариант | Тест |
|---|---|
| Пустой скан не стирает каталог | `test_empty_scan_does_not_wipe_catalog` |
| Guard молчит на свежем корне (known = 0) | `test_guard_does_not_fire_on_fresh_root` |
| Пропавшая книга помечается, а не удаляется | `test_deleted_book_is_marked_missing_not_removed` |
| Путь книги не выходит за корень | `test_resolve_target_rejects_path_outside_library` |
| Мутирующие роуты требуют `X-Booklib` | `test_open_requires_own_page_header` |
| `/api/settings` тоже требует `X-Booklib` | `test_settings_require_own_page_header` |
| Правки переживают рескан | `test_override_wins_and_survives_rescan` |
| Правки переживают смену корня и возврат | `test_edits_survive_switch_away_and_back` |
| Смена корня не трогает старый слот | `test_switch_root_gets_own_slot` |
| Legacy-состояние мигрирует в слот | `test_legacy_state_migrates_into_slot` |
| Legacy-состояние не уезжает в чужой слот | `test_legacy_state_does_not_cross_into_foreign_slot` |
| `unicode_ci`/`pylower` есть на любом соединении | `test_collations_registered_on_plain_connect` |
| Программный `Settings(root=…)` побеждает config.json | `test_programmatic_root_wins_over_runtime_config` |
| Конфиг ищется по `cache_dir` из `.env` | `test_runtime_config_found_via_dotenv_cache_dir` |
| Бюджет предпросмотра считает и не-книжные файлы | `test_budget_counts_non_book_files_too` |
| Библиотека может совпадать с cwd процесса | `test_validate_accepts_library_equal_to_cwd` |
| Правила находятся при установке колесом | `test_package_default_when_config_dir_missing` |
| Правила смотрят на имя файла, не на папку | `test_match_text_ignores_directory` |
| Кириллица ищется без учёта регистра | `test_search_is_case_insensitive_for_cyrillic` |
| Кириллица сортируется без учёта регистра | `test_cyrillic_title_sort_ignores_case` |

Тесты работают на временном корне и настоящую библиотеку не трогают.
