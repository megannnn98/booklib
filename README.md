# booklib

Локальный веб-каталог библиотеки `/run/media/b/DOWNLOADS/books`: превью на каждую книгу,
разделы по смыслу, клик открывает папку в nemo с выделенным файлом.

Библиотека читается **строго read-only** — это активные раздачи qBittorrent,
переименование или перемещение сломает fastresume-файлы.

## Запуск и остановка

Сервис живёт как systemd unit пользователя `booklib.service` и слушает
http://127.0.0.1:8765.

### Жизненный цикл

```bash
systemctl --user start booklib.service    # поднять
systemctl --user stop booklib.service     # остановить
systemctl --user restart booklib.service  # перезапустить
systemctl --user status booklib.service   # состояние
```

То же через make: `make restart` (перезапуск + первые строки статуса),
`make logs`.

### Логи

```bash
journalctl --user -u booklib.service -f   # живой хвост журнала
make logs                                 # последние 50 строк
```

### Автозапуск

Уже включён (`systemctl --user is-enabled booklib.service` → `enabled`). Управление:

```bash
systemctl --user enable booklib.service   # автозапуск вместе с сессией
systemctl --user disable booklib.service  # отключить
```

Скан библиотеки выполняется при каждом старте сервиса (инкрементальный,
на неизменной библиотеке ~0.1 с).

### Ручной запуск без systemd

```bash
make serve    # то же, что uv run booklib serve
```

Останавливается по Ctrl+C. Удобно для отладки, когда журнал юнита неудобен.

### Установка юнита на новой машине

```bash
mkdir -p ~/.config/systemd/user
ln -s ~/booklib/booklib.service ~/.config/systemd/user/booklib.service
systemctl --user daemon-reload
systemctl --user enable --now booklib.service
```

Юнит установлен симлинком: правка `booklib.service` в репозитории меняет
установленный юнит немедленно, поэтому после неё обязателен
`systemctl --user daemon-reload`.

### Поведение, которое не баг

- Сервис поднялся сам после падения — это `Restart=on-failure` с паузой
  `RestartSec=5`, штатная конфигурация юнита.
- Сервис остановился при выходе из графической сессии — юнит объявлен
  `PartOf=graphical-session.target` и живёт вместе с сессией.

## Где что лежит

| Что | Где |
|---|---|
| Код | `~/booklib/src/booklib` |
| СУБД и кэш обложек | `~/.cache/booklib/{library.db,covers/}` |
| Разовая раскладка | `~/booklib/config/taxonomy.json` (локально, не в git) |
| Правила для новых книг | `~/booklib/config/rules.json` |
| Ручные правки из UI | таблица `overrides` в СУБД |

## Раскладка библиотеки

`config/taxonomy.json` — это опись конкретной библиотеки, поэтому в репозиторий она
не коммитится. Формат показан в `config/taxonomy.example.json`, а как её собрать — в `scripts/README.md`. Без этого файла
каталог тоже работает: все книги разложатся по `config/rules.json`, остальное уедет
в раздел «Новое».

## Модель данных

Карточка книги = файлы в одной папке с общим именем после нормализации
(снимаются `.a4`/`.a6` и машинные хвосты `_p117_1`, `_v3`). Поэтому одна книга
в четырёх форматах — одна карточка, а шесть томов Михайловского — шесть.

Раздел карточки берётся по приоритету:

1. `overrides` — правки из UI, переживают рескан;
2. `taxonomy.json` — разовая ручная раскладка всех книг;
3. `rules.json` — regex по **имени файла** (папка игнорируется намеренно: в
   `programming-embedded` лежит анархистская литература);
4. раздел «Новое».

## Командная строка

```bash
uv run booklib scan --dry-run                 # статистика без записи в СУБД
uv run booklib scan --show "Эвола"            # как сгруппировались файлы
uv run booklib covers --report                # книги без обложки и причины
uv run booklib covers --force                 # перегенерировать все превью (~30 с)
uv run booklib sections                       # применить разделы и показать раскладку
uv run booklib classify "путь/файл.pdf"       # в какой раздел попадёт новая книга
uv run booklib open --dry-run "<ключ>"        # проверить путь, не открывая nemo
uv run booklib doctor                         # проверка окружения
```

Разработка: `make help`, `make fmt`, `make lint`, `make typecheck`, `make test`, `make hooks`.

## Безопасность

Сервис слушает только `127.0.0.1`, но этого мало: `/api/open` запускает процессы,
а послать POST на localhost может любая открытая вкладка. Поэтому:

- `/api/open`, `/api/rescan` и `/api/book` требуют заголовок `X-Booklib`
  (кросс-доменный запрос не может его выставить без CORS-preflight, а preflight
  сервис не обслуживает);
- путь книги резолвится и проверяется на принадлежность корню библиотеки — иначе 403.

**Не меняйте `BOOKLIB_HOST` на `0.0.0.0`.** Открытый наружу `/api/open` — это
запуск процессов в вашей сессии по запросу из сети.

## Поведение при отключённом диске

Диск внешний. Если он не смонтирован:

- сервис стартует и отдаёт каталог из кэша;
- в сайдбаре красная плашка «библиотека не смонтирована»;
- скан **прерывается** и НЕ помечает книги пропавшими — иначе одна перезагрузка
  без диска стёрла бы всю ручную раскладку;
- `/api/open` отвечает 503, `/api/rescan` — 503.
