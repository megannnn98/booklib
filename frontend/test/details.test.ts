import { describe, expect, it, vi } from "vitest";

import { createCards } from "../src/cards";
import { createState } from "../src/catalog_state";
import { findElements } from "../src/dom";
import { createDetails } from "../src/details";
import { makeBook, makeBookTag } from "./helpers/books";
import { mountPage } from "./helpers/page";

function setup(stateOverrides: Parameters<typeof createState>[1] = {}) {
  const doc = mountPage();
  const el = findElements(doc);
  const state = createState(null, stateOverrides);
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
  const deps = {
    doc,
    el,
    state,
    cards,
    openBook: vi.fn(),
    editBook: vi.fn(),
    applyTagFilter: vi.fn(),
    fillFiles: vi.fn(async () => {}),
  };
  return { doc, el, state, deps, details: createDetails(deps) };
}

describe("details dialog", () => {
  it("fills the cover, title, author and properties", () => {
    const { el, details } = setup();
    details.openDetails(
      makeBook({
        title: "Анализ",
        author: "Фихтенгольц",
        year: 1948,
        section: "Математика",
        formats: ["pdf", "djvu"],
        size_mb: 12.5,
        key: "math/Анализ",
      }),
    );

    expect(el.details.open).toBe(true);
    expect(el.dCover.querySelector("img")).not.toBeNull();
    expect(el.dTitle.textContent).toBe("Анализ");
    expect(el.dAuthor.textContent).toBe("Фихтенгольц");

    const props = [...el.dProps.querySelectorAll("dt, dd")].map((node) => node.textContent);
    expect(props).toEqual([
      "Раздел",
      "Математика",
      "Год",
      "1948",
      "Форматы",
      "PDF, DJVU",
      "Размер",
      "12.5 МБ",
      "Путь",
      "math/Анализ",
    ]);
  });

  it("marks a card without an author and empty fields", () => {
    const { el, details } = setup();
    details.openDetails(makeBook({ author: null, year: null, section: null }));

    expect(el.dAuthor.textContent).toBe("автор не указан");
    const props = [...el.dProps.querySelectorAll("dd")].map((node) => node.textContent);
    expect(props).toEqual(["—", "—", "PDF", "12.5 МБ", "math/Анализ"]);
  });

  it("adds the manual-edit row for an edited card", () => {
    const { el, details } = setup();
    details.openDetails(makeBook({ edited: true }));
    const props = [...el.dProps.querySelectorAll("dt, dd")].map((node) => node.textContent);
    expect(props.slice(-2)).toEqual(["Правки", "есть ручные правки"]);
  });

  it("renders tags and filters by one, closing the drawer", () => {
    const { el, deps, details } = setup();
    details.openDetails(
      makeBook({ tags: [makeBookTag({ name: "Платон" }), makeBookTag({ id: 2, name: "Гегель" })] }),
    );

    const tags = [...el.dProps.querySelectorAll(".tags .tag-chip")];
    expect(tags.map((tag) => tag.textContent)).toEqual(["Платон", "Гегель"]);

    tags[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(el.details.open).toBe(false);
    expect(deps.applyTagFilter).toHaveBeenCalledWith("Гегель");
  });

  it("offers both host actions to a local host desktop client", () => {
    const { el, deps, details } = setup({ local: true, hostDesktop: true });
    details.openDetails(makeBook());

    const labels = [...el.dActions.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["Открыть в папке", "Править"]);
    expect(el.dActions.hidden).toBe(false);

    el.dActions.querySelectorAll("button")[0]?.click();
    expect(deps.openBook).toHaveBeenCalledTimes(1);

    el.dActions.querySelectorAll("button")[1]?.click();
    expect(deps.editBook).toHaveBeenCalledTimes(1);
  });

  it("keeps only the edit action for a trusted LAN admin", () => {
    const { el, details } = setup({ local: true, hostDesktop: false });
    details.openDetails(makeBook());
    const labels = [...el.dActions.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["Править"]);
  });

  it("hides the action row for a guest", () => {
    const { el, details } = setup({ local: false, hostDesktop: false });
    details.openDetails(makeBook());
    expect(el.dActions.querySelectorAll("button")).toHaveLength(0);
    expect(el.dActions.hidden).toBe(true);
  });

  it("loads the file list into the drawer", () => {
    const { el, deps, details } = setup();
    const book = makeBook();
    details.openDetails(book);
    expect(deps.fillFiles).toHaveBeenCalledWith(el.dFiles, book);
  });

  it("focuses the close button so Escape and Tab work from the drawer", () => {
    const { el, details } = setup();
    details.openDetails(makeBook());
    expect(document.activeElement).toBe(el.dClose);
  });
});
