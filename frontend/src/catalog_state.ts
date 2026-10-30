// Состояние витрины и его чистые переходы. DOM здесь нет: сетка, диалоги и
// навигация получают готовый state и только читают/меняют его через эти функции.

import { readPref, type FilterChip, type PreferenceStorage } from "./ui_helpers";
import type { EditorTagLike } from "./tag_helpers";
import type { BookDto, FormatCountDto, SectionDto, TagDto } from "./types";

export type ViewMode = "grid" | "list";
export type Density = "standard" | "compact";

const VIEW_MODES = ["grid", "list"] as const;
const DENSITIES = ["standard", "compact"] as const;

export interface CatalogState {
  section: string;
  q: string;
  sort: string;
  tags: string[];
  formats: string[];
  sections: SectionDto[];
  local: boolean;
  hostDesktop: boolean;
  availableTags: TagDto[];
  availableFormats: FormatCountDto[];
  editorTags: EditorTagLike[];
  selectedTagId: number | null;
  view: ViewMode;
  density: Density;
  books: BookDto[];
  total: number;
  // Номер последнего запроса каталога: ответ устаревшего запроса (пользователь
  // успел сменить фильтр) не должен перезаписать витрину.
  requestSeq: number;
}

export function createState(
  storage: PreferenceStorage | null | undefined,
  overrides: Partial<CatalogState> = {},
): CatalogState {
  return {
    section: "*",
    q: "",
    sort: "title",
    tags: [],
    formats: [],
    sections: [],
    local: true,
    hostDesktop: false,
    availableTags: [],
    availableFormats: [],
    editorTags: [],
    selectedTagId: null,
    view: readPref(storage, "booklib.view", VIEW_MODES, "grid"),
    density: readPref(storage, "booklib.density", DENSITIES, "standard"),
    books: [],
    total: 0,
    requestSeq: 0,
    ...overrides,
  };
}

export function viewName(state: Pick<CatalogState, "section" | "sort">): string {
  if (state.section !== "*") {
    return state.section;
  }
  return state.sort === "added" ? "Недавно добавленные" : "Все книги";
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }
  return many;
}

export function bytesLabel(sizeMb: number): string {
  if (sizeMb >= 1024) {
    return `${(sizeMb / 1024).toFixed(1)} ГБ`;
  }
  if (sizeMb >= 1) {
    return `${sizeMb.toFixed(1)} МБ`;
  }
  return `${Math.max(1, Math.round(sizeMb * 1024))} КБ`;
}

/** Подпись под названием: автор и год, иначе размер. */
export function bookMeta(book: BookDto): string {
  const parts = [book.author, book.year].filter(
    (part): part is string | number => part !== null && part !== undefined && part !== "",
  );
  return parts.length ? parts.join(" · ") : bytesLabel(book.size_mb);
}

/** Остаток каталога: сколько ещё можно подгрузить. */
export function restCount(state: Pick<CatalogState, "books" | "total">): number {
  return state.total - state.books.length;
}

export function moreLabel(state: Pick<CatalogState, "books" | "total">, pageSize: number): string | null {
  const rest = restCount(state);
  if (rest <= 0) {
    return null;
  }
  return `Показать ещё ${Math.min(rest, pageSize)} из ${rest}`;
}

export function toggleTag(state: { tags: string[] }, name: string): void {
  state.tags = state.tags.includes(name)
    ? state.tags.filter((item) => item !== name)
    : [...state.tags, name];
}

export function toggleFormat(state: { formats: string[] }, name: string): void {
  state.formats = state.formats.includes(name)
    ? state.formats.filter((item) => item !== name)
    : [...state.formats, name];
}

export function removeChip(state: CatalogState, chip: FilterChip): void {
  switch (chip.kind) {
    case "section":
      state.section = "*";
      return;
    case "q":
      state.q = "";
      return;
    case "tag":
      state.tags = state.tags.filter((name) => name !== chip.value);
      return;
    case "format":
      state.formats = state.formats.filter((name) => name !== chip.value);
      return;
  }
}

/** Кнопка «Сбросить фильтры» в панели: снимает только теги и форматы. */
export function clearPanelFilters(state: CatalogState): void {
  state.tags = [];
  state.formats = [];
}

/** «Сбросить всё» над витриной и кнопка пустого состояния: снимает и раздел. */
export function resetAllFilters(state: CatalogState): void {
  state.q = "";
  state.tags = [];
  state.formats = [];
  state.section = "*";
}

/** Выбор реального раздела выключает виртуальный порядок «недавно добавленные». */
export function sectionSort(sort: string): string {
  return sort === "added" ? "title" : sort;
}

export interface RequestSequence {
  next(): number;
  isCurrent(sequence: number): boolean;
}

export function createRequestSequence(): RequestSequence {
  let current = 0;
  return {
    next: () => {
      current += 1;
      return current;
    },
    isCurrent: (sequence: number) => sequence === current,
  };
}
