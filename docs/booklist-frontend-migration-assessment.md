# Оценка миграции Booklib на инструменты `booklist-frontend`

Дата исследования: 2026-09-01. Upstream зафиксирован на commit
[`8b7fd2d`](https://github.com/alex-altay/booklist-frontend/tree/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996),
а не на подвижной ветке `main`. Выводы ниже основаны на исходниках этого
commit и на текущем рабочем дереве Booklib; код не менялся.

## Короткий вывод

Переписать **витрину** Booklib на Vue-стек upstream реально, но это не
перенос готового приложения: у проектов разные предметные модели и контракты.
`booklist-frontend` — клиент для личного дневника прочитанного с внешним
backend, WebAuthn и CRUD записей. Booklib — локальный каталог файлов с
FastAPI/SQLite, ресканом, обложками, скачиванием и намеренно разными LAN/localhost
правами. Upstream не содержит server-side кода, миграций или API-спецификации,
которая могла бы заменить Booklib backend.

Практичный путь: оставить Python/FastAPI, SQLite, сканер и security boundary
Booklib; заменить только `src/booklib/api/static/` независимым Vue 3 +
TypeScript приложением, добавив тонкий typed API client к **существующим**
`/api/*`. Это проект средней-высокой сложности: ориентировочно 4--7
инженерных недель для функционального SPA с регрессионными browser/API-тестами
после отдельного 3--5-дневного design/API-spike. Оценка предполагает одного
разработчика, известный дизайн и отсутствие добавления аккаунтов/облачной
синхронизации.

Полностью переписать Booklib «теми же инструментами» нельзя без выбора и
реализации нового backend: Vite/Vue/Pinia/Zod -- frontend-инструменты, а
upstream обращается к отсутствующему в репозитории API. Если под «весь код»
понимается также scanner, генерация обложек, SQLite-состояние и LAN-политика,
это отдельная миграция backend/domain на 10--16+ инженерных недель сверх
frontend; она не даёт функционального выигрыша и создаёт высокий риск потери
инвариантов.

## Что именно использует upstream

| Область | Подтверждённый факт | Значение для Booklib |
|---|---|---|
| UI | Vue 3.5, TypeScript, Vue Router 4, Pinia 3, Tailwind 4, reka-ui/shadcn-vue, Zod 4, Axios, Unovis и Vite. | Vue/TS, Router, Pinia, Zod, Axios, Tailwind и библиотека компонентов можно выбрать для новой витрины. GSAP/Unovis нужны только если действительно нужны анимации/статистика. |
| Сборка/качество | Node 22; `build` = `vue-tsc && vite build`; есть ESLint, Prettier, Vitest, Husky/lint-staged. | Добавляет Node toolchain к текущему Python/uv. Можно воспроизвести typecheck/lint/test/build в CI. |
| Routes | Public: `/`, `/privacy`, `/terms`, `/signup`, `/signin`, 404. Auth-required: `/books`, `/books/:id`, `/books/:id/edit`, `/books/add`, `/stats`. | Неприменимы как готовая карта: Booklib нужны каталог, раздел, поиск, теги, настройки, открытие локального файла и скачивание. |
| Клиентское API | Axios берёт base URL из обязательного `VITE_HOST`; Zod валидирует ответы. Bearer token ставится в default Authorization header. | Полезны typed client + runtime validation. Нельзя слепо вводить Bearer token: текущая модель Booklib основана на loopback/Caddy marker + `X-Booklib`, а не на пользователях. |
| Deploy | Vite строит `dist/`; Caddy в Railway отдаёт SPA, health endpoint, gzip и строгий CSP; `API_ORIGIN` обязателен в CSP. `nixpacks.toml` ставит Caddy. | Локальный `booklib.service` сейчас поднимает uvicorn, а статику раздаёт FastAPI. Нужен осознанный выбор: FastAPI раздаёт `dist`, или отдельный Caddy reverse-proxy. Railway/Nixpacks не являются переносимым deployment решением для локальной библиотеки. |
| Backend | В дереве есть только frontend API wrappers; запросы идут на `books`, `books/create`, `books/update/:id`, `books/delete/:id` и `webauthn/*`. Backend-реализации нет. | Это главный gap: upstream нельзя развернуть как замену Booklib без сохранения/создания server API. |

Первичные исходники: [`package.json`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/package.json),
[`README.md`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/README.md),
[`routes.ts`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/src/router/routes.ts),
[`book.ts`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/api/book.ts),
[`webauthn.ts`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/api/webauthn.ts),
[`Caddyfile`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/Caddyfile)
и [`nixpacks.toml`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/nixpacks.toml).

## Контракт данных: несовместимость не косметическая

Upstream `Book` имеет `id:number`, `title`, `author`, `language` (`DE|EN|RU`),
`startDate`, `endDate`, `status` (`FINISHED|DROPPED`), `description`, рейтинг
из 10 enum-значений, category из 6 enum-значений и `userId`. Это подтверждено
[`schemas/book/book.ts`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/src/schemas/book/book.ts),
[`categories.ts`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/src/schemas/book/categories.ts),
[`languages.ts`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/src/schemas/book/languages.ts),
[`status.ts`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/src/schemas/book/status.ts)
и [`ratings.ts`](https://github.com/alex-altay/booklist-frontend/blob/8b7fd2dc9119f7a4b80bf0c72ee8bbb5290e2996/src/schemas/book/ratings.ts).

Booklib возвращает и хранит иной объект: стабильный `key` из относительного
пути/нормализованного basename, `dir`, `formats`, `files_json`, `primary_file`,
размер, `has_cover`, `missing`, section/override и набор tag. Это не может
без потери данных быть отображено в upstream `Book`.

| Возможность Booklib | Статус при переносе UI upstream | Минимальное решение |
|---|---|---|
| Каталог, section, поиск, сортировка, offset/limit | Есть похожий список и локальная фильтрация, но не тот контракт. | Новый `BookCard`/list store и Zod-schema для `/api/books`, server-side query сохраняется. |
| Обложки и несколько файлов книги | Отсутствует. | Отдельные поля `coverUrl`, `files`, download/action UI. |
| Рескан, status, настройка корня | Отсутствует. | Отдельные административные страницы/диалоги. |
| Ручная правка title/author/section и теги | Есть edit form, но поля и CRUD другие. | Новый Booklib form и tag-management client; не адаптировать поля дневника. |
| Открыть файл на компьютере | Отсутствует. | Действие доступно только при `status.local`; 403 надо показывать как ожидаемое ограничение. |
| Чтение/скачивание с LAN | Отсутствует. | Сохранить публичные read/download routes и не хранить admin capability в SPA. |
| Личный дневник, даты чтения, рейтинг, статистика | В Booklib сейчас отсутствует. | Отдельная новая фича с миграцией схемы и UX-решением; не часть frontend rewrite. |

Текущая проверяемая сторона Booklib описана в
[`src/booklib/api/app.py`](../src/booklib/api/app.py) (маршруты `/api/status`,
`/api/sections`, `/api/books`, cover/files/download, privileged settings/open/edit/tag CRUD),
[`src/booklib/db.py`](../src/booklib/db.py) (SQLite-схема) и
[`docs/ai-context/architecture.md`](ai-context/architecture.md) (границы слоёв
и security-инварианты).

## Что переиспользовать, а что переписать

**Можно переиспользовать как инженерный подход или зависимость:** Vite Vue
template, TypeScript aliases, Router lazy loading, Pinia stores, `useApi`
паттерн, Axios response normalization, Zod на API boundary, Tailwind/reka-ui,
Vitest, ESLint/Prettier/Husky и Caddy SPA fallback/CSP идеи. Не следует
копировать upstream UI-код без лицензии/проверки лицензии и без адаптации к
другой модели.

**Нужно написать заново:** Booklib-specific router/views, API client and Zod
schemas, list/filter/card/details/files, tags, settings/rescan/open states,
ошибки 400/403/503, mobile download UX и E2E/browser tests. `book.ts`,
`BookForm.vue`, stats widgets и WebAuthn flows upstream не являются
функционально совместимыми базовыми блоками.

**Нужно сохранить неизменным на первом этапе:** `scanner`, `grouping`,
`covers`, `taxonomy`, `tags`, database schema/миграции, `service`, FastAPI
маршруты и `require_local`/`require_own_page`. Это уже покрыто тестами и несёт
основную доменную и security-сложность Booklib.

## Риски, которые определяют цену

1. **Security regression -- высокий риск.** В upstream authenticated routes
   защищаются клиентским guard по наличию токена; это не серверная авторизация.
   В Booklib privilege проверяется на сервере по local peer и marker. Перенос
   WebAuthn/JWT не должен заменять `require_local` без отдельного threat model,
   CORS/CSP/credential design и тестов forged headers.
2. **Несовместимый API -- высокий риск.** Upstream загружает весь список и
   фильтрует его в Pinia, Booklib умеет query/pagination на сервере и допускает
   до 2000 записей. Для большой библиотеки нельзя деградировать до полного
   download без измерения памяти/latency.
3. **Два сервера и origin -- средний риск.** Отдельный Vite/Caddy origin
   потребует CORS и ослабит простой same-origin контракт. Предпочтительно
   собирать SPA в `dist` и раздавать его same-origin FastAPI либо ставить
   локальный Caddy как единственную точку входа с точными proxy headers.
4. **Deploy mismatch -- средний риск.** Railway/Nixpacks отвечают потребностям
   публичного облачного SPA, Booklib -- user systemd и локальный ФС/DBus.
5. **Поставка frontend -- средний риск.** Нужны решения: хранить собранный
   `dist` в Python package или собирать Node на целевой машине/в release CI.
   Второй вариант добавляет Node 22 в установку и усложняет offline deploy.

## Безопасная последовательность

1. **Spike (3--5 дней):** зафиксировать целевой UX и API mapping, создать
   отдельный Vite/Vue skeleton без удаления текущей статики; построить Zod
   схемы из реальных JSON fixture `/api/books`, `/api/tags`, `/api/status`.
2. **Read-only vertical slice (1--2 недели):** sections, server-side list/search,
   card/cover, details/files/download; browser-тесты для localhost и LAN read
   path. Старая статика остаётся rollback-вариантом.
3. **Privileged slice (1--2 недели):** settings/preview/apply, rescan, edit,
   open и tags. Проверить, что каждый mutate запрос сохраняет `X-Booklib`, а
   remote/forged header остаётся 403.
4. **Packaging and rollout (1--2 недели):** Vite build в wheel/release,
   CSP, service/Caddy решение, CI для `typecheck`, `lint`, `test`, `build`,
   migration/rollback smoke test. Только затем удалить legacy static UI.

Если цель -- получить визуальный язык upstream, а не дневник чтения, это
реалистичный минимальный scope. Если целью является именно продуктовые
возможности upstream (accounts/passkeys, статусы чтения, заметки, рейтинг и
statistics), сначала нужен отдельный product/domain decision: это расширение
Booklib, не технологическая миграция.
