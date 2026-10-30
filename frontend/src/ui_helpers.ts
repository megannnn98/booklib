// Чистые функции витрины без DOM: фильтры, query-строка каталога, префы вида.
// Всё, что здесь есть, обязано работать без браузера — это проверяет vitest.

export type SortKey = "title" | "added" | "year" | "size";

/** Состояние фильтров, из которого строится запрос каталога. */
export interface QueryFilters {
  section: string;
  q: string;
  sort: string;
  tags: readonly string[];
  formats: readonly string[];
}

export type FilterKind = "section" | "q" | "tag" | "format";

/** Активный фильтр в виде чипа над витриной. */
export interface FilterChip {
  kind: FilterKind;
  value: string;
  label: string;
}

/** Строка навигации по разделам: имя и число карточек. */
export interface SectionCount {
  name: string;
  count: number;
}

/**
 * Минимум от Storage, который нужен префам вида. Именно минимум, а не Storage:
 * тесты подставляют Map-обёртку, а приватный режим даёт бросающий объект.
 */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Порядок параметров фиксирован: тест сравнивает строку целиком, а браузеру
// одинаковый URL для одного и того же состояния даёт попадание в HTTP-кэш.
export function buildBooksQuery(filters: QueryFilters, offset: number, limit: number): string {
  const params = new URLSearchParams({ section: filters.section, sort: filters.sort });
  if (filters.q) {
    params.set("q", filters.q);
  }
  for (const tag of filters.tags) {
    params.append("tag", tag);
  }
  for (const format of filters.formats) {
    params.append("format", format);
  }
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  // URLSearchParams по спеке не экранирует «*», но полагаться на это незачем:
  // сервер понимает оба варианта, а человеку в адресной строке читается «*».
  return params.toString().replace("section=%2A", "section=*");
}

export function activeFilters(filters: QueryFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.section && filters.section !== "*") {
    chips.push({ kind: "section", value: filters.section, label: filters.section });
  }
  if (filters.q) {
    chips.push({ kind: "q", value: filters.q, label: `«${filters.q}»` });
  }
  for (const tag of filters.tags) {
    chips.push({ kind: "tag", value: tag, label: `#${tag}` });
  }
  for (const format of filters.formats) {
    chips.push({ kind: "format", value: format, label: format.toUpperCase() });
  }
  return chips;
}

export function filterSections(sections: readonly SectionCount[], term: string): SectionCount[] {
  const needle = term.trim().toLowerCase();
  if (!needle) {
    return [...sections];
  }
  return sections.filter((item) => item.name.toLowerCase().includes(needle));
}

// localStorage может бросать (приватный режим, запрет cookies) — настройки
// вида тогда просто не запоминаются, витрина работает с умолчаниями.
export function readPref<const T extends string>(
  storage: PreferenceStorage | null | undefined,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const value = storage ? storage.getItem(key) : null;
    return allowed.find((candidate) => candidate === value) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePref(
  storage: PreferenceStorage | null | undefined,
  key: string,
  value: string,
): void {
  try {
    storage?.setItem(key, value);
  } catch {
    /* не запомнили — не страшно */
  }
}

// Оттенок заглушки обложки: стабилен для названия, чтобы витрина не «мигала»
// цветами между перезагрузками.
export function placeholderHue(text: string | null | undefined): number {
  let hash = 0;
  for (const char of String(text ?? "")) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  }
  return hash;
}
