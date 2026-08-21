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
booklib.tags               словарь тегов и ручные назначения книгам
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
| Теги | таблицы `tags`, `tag_aliases`, `book_tags` | вторая ось классификации; ручные назначения живут в SQLite |

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
| Удалённый клиент не трогает привилегированные ручки | `test_remote_is_blocked_from_privileged_routes` |
| `GET /api/tags` и фильтр по тегу доступны гостю | `test_public_tags_and_book_tags`, `test_remote_can_read_tags` |
| Гость не меняет теги, локально без `X-Booklib` — тоже | `test_remote_cannot_mutate_tags`, `test_remote_is_blocked_from_privileged_routes`, `test_local_without_header_is_403` |
| Имена и алиасы тегов уникальны без учёта регистра | `test_tags_are_case_insensitively_unique`, `test_aliases_are_case_insensitively_unique` |
| Имя тега и алиас чужого тега не пересекаются | `test_name_and_alias_conflict_cross_tables`, `test_update_tag_rejects_alias_conflict` |
| Несколько `?tag=` — пересечение, а не объединение | `test_several_tags_filter_by_and` |
| Фильтр тегов складывается с разделом, поиском, пагинацией | `test_tag_filter_composes_with_section_and_search` |
| Поиск находит книгу по имени тега и по алиасу | `test_search_finds_book_by_tag_name` |
| Теги переживают рескан, пропажу и возврат книги | `test_tags_survive_rescan_and_book_disappearance` |
| `count` тега не считает пропавшие книги | `test_tags_count_ignores_missing_books` |
| Замена набора тегов — это набор одной карточки | `test_removing_tag_from_one_book_keeps_other_books`, `test_set_book_tags_replaces_manual_tags_only` |
| Используемый тег не удаляется, merge не теряет связи | `test_delete_used_tag_is_blocked`, `test_merge_moves_book_links_and_aliases` |
| `/api/status` не показывает пути ФС гостю | `test_status_local_flag_and_paths` |
| Гостю доступны лист файлов и скачивание | `test_files_lists_formats_in_primary_order`, `test_download_serves_file_with_attachment` |
| Range/206 при скачивании | `test_download_supports_range` |
| Скачивание вне карточки и traversal → 403 | `test_download_file_not_in_card_is_403`, `test_download_traversal_is_403` |

## Доступ по сети

Витрина умеет слушать сеть (`BOOKLIB_HOST=0.0.0.0`) для чтения и скачивания с
телефона. Разделение ролей — на уровне роутеров, а не ручек:

- **`priv_routes`** (`APIRouter`) — всё, что меняет или запускает процессы:
  `/api/rescan`, `/api/settings*`, `/api/open`, `/api/book`, теги-CRUD и
  `PUT /api/book/{key:path}/tags`. Две зависимости:
  `require_own_page` (`X-Booklib`) и `require_local` (только `127.0.0.1`/`::1`,
  fail-closed). Новая мутирующая ручка добавляется в этот роутер и не может
  «забыть» проверку роли.
- **`app`** — публичные ручки: `/api/status` (с `local` и скрытыми для гостя
  путями ФС), `/api/cover`, `/api/files`, `/api/download`, `GET /api/tags`.
  То, чем можно делиться ссылкой.

Теги — вторая ось классификации, независимая от `section`. Словарь (`tags`,
`tag_aliases`) отделён от назначений (`book_tags`), поэтому рескан их не
трогает: сканер удаляет строки `books` никогда, только ставит `missing = 1`,
и пропавшая книга возвращается со своими тегами. `book_tags.source` заведён
под этап 2 (автоматическая расстановка) — ручная замена набора удаляет только
`source = 'manual'`. Фильтр `?tag=` принимает и каноническое имя, и алиас:
имена резолвятся в id один раз, дальше на каждый id идёт свой `EXISTS`, что и
даёт AND и складывается с `section`, `q`, `sort`, `limit`, `offset` в общем
`where`.

`/api/download` защищён двумя независимыми guard'ами: `file` обязан быть
элементом `files_json` карточки (whitelist по построению) и после `resolve()`
путь остаётся в корне библиотеки (`is_relative_to`, инвариант №5). Лист файлов
и порядок форматов берутся из `files_json` = `group.files`, уже упорядоченный по
`FORMAT_PREFERENCE`.

Файрвол на машине не поднят не случайно, а как принятое решение в пользу
чтения библиотеке всей домашней сетью и docker-бриджами; защита привилегий — это
`require_local` + тесты, а не адрес. Документировано в README «Доступ с телефона».

Тесты работают на временном корне и настоящую библиотеку не трогают.
