import { describe, expect, it, vi } from "vitest";

import { createCards } from "../src/cards";
import { createCatalog } from "../src/catalog";
import { createState } from "../src/catalog_state";
import { findElements } from "../src/dom";
import { createToast } from "../src/toast";
import { buildBooksQuery } from "../src/ui_helpers";
import { makeBook } from "./helpers/books";
import { stubBackend } from "./helpers/backend";
import { mountPage } from "./helpers/page";

const PAGE_SIZE = 120;

function setup(
  stateOverrides: Parameters<typeof createState>[1] = {},
  booksRoute?: (offset: number) => unknown,
) {
  const doc = mountPage();
  const el = findElements(doc);
  const state = createState(null, stateOverrides);
  const backend = stubBackend(
    booksRoute
      ? {
          "/api/books": (call: { path: string }) => {
            const offset = Number(new URLSearchParams(call.path.split("?")[1]).get("offset") ?? 0);
            return booksRoute(offset);
          },
        }
      : {},
  );
  const onResetFilters = vi.fn();
  const cards = createCards({
    doc,
    state,
    openDetails: vi.fn(),
    editBook: vi.fn(),
    openBook: vi.fn(),
    openFiles: vi.fn(),
    applyTagFilter: vi.fn(),
    sortBy: vi.fn(),
  });
  const catalog = createCatalog({
    doc,
    el,
    state,
    api: backend.api,
    cards,
    toast: createToast(el, { after: () => 1, clear: () => {} }),
    pageSize: PAGE_SIZE,
    onResetFilters,
  });
  return { doc, el, state, backend, catalog, onResetFilters };
}

describe("loadBooks", () => {
  it("requests the first page with the current filters and renders it", async () => {
    const { el, state, backend, catalog } = setup({ section: "Математика", q: "анализ", tags: ["a"] }, () => ({
      total: 3,
      books: [makeBook({ key: "m/1" }), makeBook({ key: "m/2" })],
    }));

    await catalog.loadBooks();

    const call = backend.find("GET", "/api/books");
    expect(call?.path).toBe(`/api/books?${buildBooksQuery(state, 0, PAGE_SIZE)}`);
    expect(state.books.map((book) => book.key)).toEqual(["m/1", "m/2"]);
    expect(state.total).toBe(3);
    expect(el.grid.querySelectorAll(".card")).toHaveLength(2);
    expect(el.counter.textContent).toBe("3 книги");
    expect(el.more.hidden).toBe(false);
    expect(el.moreBtn.textContent).toBe("Показать ещё 1 из 1");
  });

  it("ignores a response that arrived after a newer request", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const { state, catalog } = setup({}, () => new Promise((resolve) => pending.push(resolve)));
    state.q = "старый";
    const stale = catalog.loadBooks();
    state.q = "новый";
    const fresh = catalog.loadBooks();

    pending[1]?.({ total: 1, books: [makeBook({ key: "fresh" })] });
    await fresh;
    pending[0]?.({ total: 1, books: [makeBook({ key: "stale" })] });
    await stale;

    expect(state.books.map((book) => book.key)).toEqual(["fresh"]);
  });

  it("shows a retryable error state", async () => {
    let fail = true;
    const { el, state, catalog } = setup({}, () => {
      if (fail) {
        throw new Error("бэкенд недоступен");
      }
      return { total: 1, books: [makeBook({ key: "ok" })] };
    });

    await catalog.loadBooks();

    expect(state.books).toEqual([]);
    expect(el.counter.textContent).toBe("");
    expect(el.more.hidden).toBe(true);
    expect(el.grid.textContent).toContain("Каталог не загрузился");
    expect(el.grid.textContent).toContain("бэкенд недоступен");

    fail = false;
    el.grid.querySelector("button")?.click();
    await vi.waitFor(() => expect(el.grid.querySelectorAll(".card")).toHaveLength(1));
  });

  it("draws skeletons only for the empty grid view", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const grid = setup({}, () => new Promise((resolve) => pending.push(resolve)));
    const request = grid.catalog.loadBooks();
    expect(grid.el.grid.querySelectorAll(".card.skeleton")).toHaveLength(12);
    pending[0]?.({ total: 0, books: [] });
    await request;
    expect(grid.el.grid.querySelectorAll(".card.skeleton")).toHaveLength(0);

    const list = setup({ view: "list" }, () => new Promise((resolve) => pending.push(resolve)));
    void list.catalog.loadBooks();
    expect(list.el.grid.querySelectorAll(".card.skeleton")).toHaveLength(0);
  });

  it("blocks the more button while the first page is in flight", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const { el, catalog } = setup({}, () => new Promise((resolve) => pending.push(resolve)));
    const request = catalog.loadBooks();
    expect(el.moreBtn.disabled).toBe(true);
    pending[0]?.({ total: 0, books: [] });
    await request;
  });
});

describe("empty catalogue", () => {
  it("points an unfiltered empty catalogue to the scan", async () => {
    const { el, catalog, onResetFilters } = setup({}, () => ({ total: 0, books: [] }));
    await catalog.loadBooks();

    expect(el.grid.textContent).toContain("Ничего не найдено");
    expect(el.grid.textContent).toContain("Каталог пуст — запустите скан.");
    expect(el.grid.querySelector("button")).toBeNull();
    expect(onResetFilters).not.toHaveBeenCalled();
  });

  it("offers to reset filters when they hide everything", async () => {
    const { el, catalog, onResetFilters } = setup({ q: "нет-такого" }, () => ({ total: 0, books: [] }));
    await catalog.loadBooks();

    expect(el.grid.textContent).toContain("Попробуйте ослабить фильтры или изменить запрос.");
    el.grid.querySelector("button")?.click();
    expect(onResetFilters).toHaveBeenCalled();
  });
});

describe("view classes", () => {
  it("switches grid/list and the compact class", async () => {
    const grid = setup({}, () => ({ total: 1, books: [makeBook()] }));
    await grid.catalog.loadBooks();
    expect(grid.el.grid.className).toBe("view-grid");

    grid.state.density = "compact";
    grid.catalog.renderCatalog();
    expect(grid.el.grid.className).toBe("view-grid compact");

    grid.state.view = "list";
    grid.catalog.renderCatalog();
    expect(grid.el.grid.className).toBe("view-list");
    expect(grid.el.grid.querySelector(".list-head")).not.toBeNull();
    expect(grid.el.grid.querySelector(".row")).not.toBeNull();
  });
});

describe("loadMoreBooks", () => {
  it("appends the next page and updates the counter", async () => {
    const { el, state, backend, catalog } = setup({}, (offset) => ({
      total: 3,
      books: offset === 0 ? [makeBook({ key: "a" }), makeBook({ key: "b" })] : [makeBook({ key: "c" })],
    }));
    await catalog.loadBooks();
    expect(el.grid.querySelectorAll(".card")).toHaveLength(2);

    await catalog.loadMoreBooks();

    const calls = backend.calls.filter((call) => call.path.startsWith("/api/books"));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.path).toBe(`/api/books?${buildBooksQuery(state, 2, PAGE_SIZE)}`);
    expect(state.books.map((book) => book.key)).toEqual(["a", "b", "c"]);
    expect(el.grid.querySelectorAll(".card")).toHaveLength(3);
    expect(el.more.hidden).toBe(true);
  });

  it("does nothing when the catalogue is already complete", async () => {
    const { state, backend, catalog } = setup({}, () => ({ total: 1, books: [makeBook()] }));
    await catalog.loadBooks();
    const before = backend.calls.length;

    await catalog.loadMoreBooks();

    expect(backend.calls.length).toBe(before);
    expect(state.books).toHaveLength(1);
  });

  it("survives a failed next page and restores the more button", async () => {
    let calls = 0;
    const { el, state, catalog } = setup({}, () => {
      calls += 1;
      if (calls > 1) {
        throw new Error("сеть отвалилась");
      }
      return { total: 5, books: [makeBook({ key: "a" })] };
    });
    await catalog.loadBooks();

    await catalog.loadMoreBooks();

    expect(state.books).toHaveLength(1);
    expect(el.more.hidden).toBe(false);
    expect(el.moreBtn.disabled).toBe(false);
    expect(el.toast.textContent).toContain("Не удалось загрузить ещё: сеть отвалилась");
  });
});

it('ignores an old pagination failure while a new first page is pending', async () => {
  let calls = 0;
  let rejectMore: ((reason: Error) => void) | undefined;
  let resolveFresh: ((value: unknown) => void) | undefined;
  const { el, state, catalog } = setup({}, () => {
    calls += 1;
    if (calls === 1) return { total: 3, books: [makeBook()] };
    if (calls === 2) return new Promise((_resolve, reject) => { rejectMore = reject; });
    return new Promise((resolve) => { resolveFresh = resolve; });
  });
  await catalog.loadBooks();
  const more = catalog.loadMoreBooks();
  state.q = 'новый';
  const fresh = catalog.loadBooks();
  rejectMore?.(new Error('old page failed'));
  await more;
  expect(el.moreBtn.disabled).toBe(true);
  expect(el.toast.hidden).toBe(true);
  resolveFresh?.({ total: 0, books: [] });
  await fresh;
});
