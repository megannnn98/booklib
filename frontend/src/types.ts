// Контракт API booklib на стороне витрины. Формы выведены из
// src/booklib/api/app.py, booklib/tags.py, booklib/rootcheck.py и
// booklib/scanner.py — это единственный источник истины, не догадки.

/** `GET /api/status`. Пути ФС приходят только локальному клиенту. */
export interface StatusResponse {
  mounted: boolean;
  local: boolean;
  host_desktop: boolean;
  total: number;
  missing: number;
  covers: number;
  last_scan: number | null;
  root?: string;
  db?: string;
}

/** `GET /api/sections` и строка навигации: имя раздела и число карточек. */
export interface SectionDto {
  name: string;
  count: number;
}

/** `GET /api/formats`: сколько карточек содержат формат. */
export interface FormatCountDto {
  name: string;
  count: number;
}

/** Полная запись словаря тегов (`GET /api/tags`). */
export interface TagDto {
  id: number;
  name: string;
  kind: string;
  description: string | null;
  created_at: number;
  aliases: string[];
  count: number;
}

/** Тег в карточке книги: `tags_for()` отдаёт только id/name/kind. */
export interface BookTagDto {
  id: number;
  name: string;
  kind: string;
}

/** Карточка в `GET /api/books`. */
export interface BookDto {
  key: string;
  title: string;
  author: string | null;
  year: number | null;
  section: string | null;
  formats: string[];
  size_mb: number;
  has_cover: boolean;
  kind: string;
  dir: string;
  edited: boolean;
  tags: BookTagDto[];
}

export interface BooksResponse {
  total: number;
  books: BookDto[];
}

/** `GET /api/files`: один файл карточки. `size_mb` null, если stat не удался. */
export interface FileEntryDto {
  file: string;
  name: string;
  format: string;
  size_mb: number | null;
}

/** Итог скана: `POST /api/rescan` и `POST /api/settings`. */
export interface RescanResult {
  added: number;
  updated: number;
  unchanged: number;
  missing: number;
  restored: number;
  covers_built: number;
  covers_failed: number;
  elapsed: number;
}

/** `GET /api/settings`. */
export interface SettingsReadOnly {
  host: string;
  port: number;
  cover_width: number;
  cover_max_height: number;
  cover_quality: number;
  render_timeout_s: number;
  tools: Record<string, boolean>;
}

export interface SettingsResponse {
  root: string;
  root_source: string;
  scan_on_start: boolean;
  db: string;
  cover_dir: string;
  mounted: boolean;
  read_only: SettingsReadOnly;
}

/** `GET /api/settings/preview`. */
export interface RootPreviewResponse {
  root: string;
  files: number;
  books: number;
  audio: number;
  truncated: boolean;
}

/** `POST /api/open`. */
export interface OpenBookResult {
  opened: string;
  dir: string;
  method: string;
}

/** `POST /api/book`. */
export interface EditBookPayload {
  key: string;
  title?: string;
  author?: string;
  section?: string;
  tags?: string[];
  reset?: boolean;
}

export type EditBookAction = "saved" | "reset";

export interface EditBookResult {
  action: EditBookAction;
  key: string;
}

/** `POST /api/settings`. */
export interface ApplyRootPayload {
  root: string;
  scan_on_start?: boolean;
}

/** `POST /api/tags`. */
export interface CreateTagPayload {
  name: string;
  kind?: string;
  description?: string;
}

/** `PUT /api/tags/{id}`. */
export interface UpdateTagPayload {
  name?: string;
  kind?: string;
  description?: string;
}

/** `POST /api/tags/merge`. */
export interface MergeTagsPayload {
  source: number;
  target: number;
}

/** Ответ мутирующих теговых ручек — обновлённая запись тега. */
export type TagMutationResponse = TagDto;

/** Тело ошибки API: у разных ручек разные поля. */
export interface ApiErrorBody {
  error?: string;
  detail?: string;
  count?: number;
}
