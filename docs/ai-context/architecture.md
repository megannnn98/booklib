# Архитектура booklib

## Слои

```
booklib.config.settings   настройки (env BOOKLIB_*), единственный источник путей
booklib.errors            LibraryUnavailable — общее исключение обхода и записи
booklib.paths             library_root / relative_to_root
booklib.db                соединение с SQLite: схема, миграции, WAL
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

Зависимости идут строго вниз: `cli` → `api` → (`scanner`, `covers`, `taxonomy`,
`opener`) → `grouping` → (`meta`, `paths`, `errors`) → `settings`.
Обратных импортов нет.

`db` стоит сбоку от этой цепочки: он зависит только от `settings`, а соединение
получают напрямую `covers`, `opener`, `api`, `cli` и `scripts/`. Сам `scanner`
его не импортирует — `sync(conn, ...)` принимает готовое соединение параметром.

Обход дерева (`grouping`) и запись в каталог (`scanner`) разделены намеренно:
`collect_groups` только читает диск и не знает про SQLite, `sync` только пишет
диф и не знает про `os.walk`.

## Хранилище

| Что | Где | Почему |
|---|---|---|
| Книги | `BOOKLIB_ROOT` | read-only, активные раздачи qBittorrent |
| Каталог | `~/.cache/booklib/library.db` | внешний диск может отвалиться |
| Превью | `~/.cache/booklib/covers/<sha1>.jpg` | 12 МБ, восстановимо из книг |
| Раскладка | `config/taxonomy.json` | НЕ в git — опись личной библиотеки |
| Правила | `config/rules.json` | в репозитории |
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
| Пропавшая книга помечается, а не удаляется | `test_deleted_book_is_marked_missing_not_removed` |
| Путь книги не выходит за корень | `test_resolve_target_rejects_path_outside_library` |
| Мутирующие роуты требуют `X-Booklib` | `test_open_requires_own_page_header` |
| Правки переживают рескан | `test_override_wins_and_survives_rescan` |
| Правила смотрят на имя файла, не на папку | `test_match_text_ignores_directory` |
| Кириллица ищется без учёта регистра | `test_search_is_case_insensitive_for_cyrillic` |

Тесты работают на временном корне и настоящую библиотеку не трогают.
