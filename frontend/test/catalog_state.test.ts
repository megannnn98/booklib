import { describe, expect, it } from "vitest";

import {
  bookMeta,
  bytesLabel,
  clearPanelFilters,
  createRequestSequence,
  createState,
  moreLabel,
  plural,
  removeChip,
  resetAllFilters,
  sectionSort,
  toggleFormat,
  toggleTag,
  viewName,
} from "../src/catalog_state";
import type { BookDto } from "../src/types";

function storageFrom(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

function book(overrides: Partial<BookDto> = {}): BookDto {
  return {
    key: "math/a",
    title: "A",
    author: null,
    year: null,
    section: null,
    formats: ["pdf"],
    size_mb: 1,
    has_cover: true,
    kind: "book",
    dir: "math",
    edited: false,
    tags: [],
    ...overrides,
  };
}

describe("createState", () => {
  it("starts from the default catalogue view", () => {
    const state = createState(storageFrom({}));
    expect(state.section).toBe("*");
    expect(state.q).toBe("");
    expect(state.sort).toBe("title");
    expect(state.tags).toEqual([]);
    expect(state.formats).toEqual([]);
    expect(state.view).toBe("grid");
    expect(state.density).toBe("standard");
    expect(state.books).toEqual([]);
    expect(state.total).toBe(0);
    expect(state.requestSeq).toBe(0);
    expect(state.local).toBe(true);
    expect(state.hostDesktop).toBe(false);
    expect(state.selectedTagId).toBeNull();
  });

  it("restores the view and density preferences", () => {
    const state = createState(storageFrom({ "booklib.view": "list", "booklib.density": "compact" }));
    expect(state.view).toBe("list");
    expect(state.density).toBe("compact");
  });

  it("ignores unknown preferences and broken storage", () => {
    expect(createState(storageFrom({ "booklib.view": "table" })).view).toBe("grid");
    const broken = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(createState(broken).view).toBe("grid");
  });
});

describe("viewName", () => {
  it("names the selected section", () => {
    expect(viewName(createState(storageFrom({}), { section: "Математика" }))).toBe("Математика");
  });

  it("names the virtual all/recent views", () => {
    expect(viewName(createState(storageFrom({})))).toBe("Все книги");
    expect(viewName(createState(storageFrom({}), { sort: "added" }))).toBe("Недавно добавленные");
    expect(viewName(createState(storageFrom({}), { sort: "size" }))).toBe("Все книги");
  });
});

describe("plural", () => {
  it("declines Russian nouns by the last digits", () => {
    expect(plural(1, "книга", "книги", "книг")).toBe("книга");
    expect(plural(2, "книга", "книги", "книг")).toBe("книги");
    expect(plural(5, "книга", "книги", "книг")).toBe("книг");
    expect(plural(11, "книга", "книги", "книг")).toBe("книг");
    expect(plural(21, "книга", "книги", "книг")).toBe("книга");
    expect(plural(111, "книга", "книги", "книг")).toBe("книг");
    expect(plural(0, "книга", "книги", "книг")).toBe("книг");
  });
});

describe("bytesLabel", () => {
  it("switches units at the same thresholds as before", () => {
    expect(bytesLabel(1024)).toBe("1.0 ГБ");
    expect(bytesLabel(2048)).toBe("2.0 ГБ");
    expect(bytesLabel(5.94)).toBe("5.9 МБ");
    expect(bytesLabel(1)).toBe("1.0 МБ");
    expect(bytesLabel(0.5)).toBe("512 КБ");
    expect(bytesLabel(0)).toBe("1 КБ");
  });
});

describe("bookMeta", () => {
  it("joins author and year when present", () => {
    expect(bookMeta(book({ author: "Гегель", year: 1807 }))).toBe("Гегель · 1807");
  });

  it("falls back to the size when the card has no author or year", () => {
    expect(bookMeta(book({ size_mb: 5.94 }))).toBe("5.9 МБ");
    expect(bookMeta(book({ year: 1999 }))).toBe("1999");
  });
});

describe("pagination", () => {
  it("counts the rest of the catalogue and labels the more button", () => {
    const state = createState(storageFrom({}), { total: 500 });
    state.books = Array.from({ length: 120 }, () => book());
    expect(moreLabel(state, 120)).toBe("Показать ещё 120 из 380");

    state.total = 170;
    expect(moreLabel(state, 120)).toBe("Показать ещё 50 из 50");
  });

  it("hides the more button when nothing is left", () => {
    const state = createState(storageFrom({}), { total: 10 });
    state.books = Array.from({ length: 10 }, () => book());
    expect(moreLabel(state, 120)).toBeNull();
  });
});

describe("filters", () => {
  it("toggles a tag on and off while keeping the order", () => {
    const state = createState(storageFrom({}));
    toggleTag(state, "a");
    toggleTag(state, "b");
    expect(state.tags).toEqual(["a", "b"]);
    toggleTag(state, "a");
    expect(state.tags).toEqual(["b"]);
  });

  it("toggles a format on and off", () => {
    const state = createState(storageFrom({}));
    toggleFormat(state, "pdf");
    expect(state.formats).toEqual(["pdf"]);
    toggleFormat(state, "pdf");
    expect(state.formats).toEqual([]);
  });

  it("removes a single active filter by its chip", () => {
    const state = createState(storageFrom({}), { q: "оксид" });
    state.section = "Химия";
    state.tags = ["органика"];
    state.formats = ["pdf"];

    removeChip(state, { kind: "tag", value: "органика", label: "#органика" });
    expect(state.tags).toEqual([]);
    expect(state.formats).toEqual(["pdf"]);

    removeChip(state, { kind: "q", value: "оксид", label: "«оксид»" });
    expect(state.q).toBe("");

    removeChip(state, { kind: "section", value: "Химия", label: "Химия" });
    expect(state.section).toBe("*");
  });

  it("clears only tags and formats from the filter panel", () => {
    const state = createState(storageFrom({}), { section: "Химия", sort: "size", q: "оксид" });
    state.tags = ["органика"];
    state.formats = ["pdf"];
    clearPanelFilters(state);
    expect(state.tags).toEqual([]);
    expect(state.formats).toEqual([]);
    expect(state.q).toBe("оксид");
    expect(state.section).toBe("Химия");
  });

  it("resets every filter but keeps the sort order", () => {
    const state = createState(storageFrom({}), { section: "Химия", sort: "size", q: "оксид" });
    state.tags = ["органика"];
    state.formats = ["pdf"];
    resetAllFilters(state);
    expect(state.q).toBe("");
    expect(state.tags).toEqual([]);
    expect(state.formats).toEqual([]);
    expect(state.section).toBe("*");
    expect(state.sort).toBe("size");
  });
});

describe("sectionSort", () => {
  it("drops the virtual recent order when a real section is selected", () => {
    expect(sectionSort("added")).toBe("title");
    expect(sectionSort("size")).toBe("size");
    expect(sectionSort("title")).toBe("title");
  });
});

describe("createRequestSequence", () => {
  it("lets only the newest request write the catalogue", () => {
    const sequence = createRequestSequence();
    const first = sequence.next();
    expect(sequence.isCurrent(first)).toBe(true);

    const second = sequence.next();
    expect(sequence.isCurrent(first)).toBe(false);
    expect(sequence.isCurrent(second)).toBe(true);
  });
});
