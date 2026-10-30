import { describe, expect, it, vi } from "vitest";

import { createState } from "../src/catalog_state";
import { findElements } from "../src/dom";
import { createTagFilter } from "../src/tag_filter";
import { makeTag } from "./helpers/books";
import { mountPage } from "./helpers/page";

function setup(stateOverrides: Parameters<typeof createState>[1] = {}) {
  const doc = mountPage();
  const el = findElements(doc);
  const state = createState(null, stateOverrides);
  const filtersChanged = vi.fn();
  const reloadBooks = vi.fn();
  const onReset = vi.fn();
  const filter = createTagFilter({ doc, el, state, filtersChanged, reloadBooks, onReset });
  return { doc, el, state, filter, filtersChanged, reloadBooks, onReset };
}

describe("active filter chips", () => {
  it("renders nothing for the default filters", () => {
    const { el, filter } = setup();
    filter.renderChips();
    expect(el.chips.children).toHaveLength(0);
    expect(el.filtersBadge.hidden).toBe(true);
    expect(el.filtersBadge.textContent).toBe("0");
  });

  it("renders one chip per filter plus a reset chip", () => {
    const { el, filter } = setup({
      section: "Химия",
      q: "оксид",
      tags: ["органика"],
      formats: ["pdf"],
    });
    filter.renderChips();

    const labels = [...el.chips.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["Химия✕", "«оксид»✕", "#органика✕", "PDF✕", "Сбросить всё"]);
    expect(el.filtersBadge.hidden).toBe(false);
    expect(el.filtersBadge.textContent).toBe("2");
    expect(el.chips.querySelector<HTMLElement>("button")?.title).toBe("Убрать фильтр");
  });

  it("removes a single filter by clicking its chip", () => {
    const { el, state, filter, filtersChanged } = setup({ tags: ["a", "b"], formats: ["pdf"] });
    filter.renderChips();

    el.chips.querySelectorAll<HTMLElement>("button")[0]?.click();

    expect(state.tags).toEqual(["b"]);
    expect(state.formats).toEqual(["pdf"]);
    expect(filtersChanged).toHaveBeenCalled();
  });

  it("drops the section back to the whole catalogue", () => {
    const { el, state, filter, filtersChanged } = setup({ section: "Химия" });
    filter.renderChips();
    el.chips.querySelector<HTMLElement>("button")?.click();
    expect(state.section).toBe("*");
    expect(filtersChanged).toHaveBeenCalled();
  });

  it("resets everything from the reset chip", () => {
    const { el, filter, onReset } = setup({ q: "оксид" });
    filter.renderChips();
    const buttons = [...el.chips.querySelectorAll<HTMLElement>("button")];
    buttons[buttons.length - 1]?.click();
    expect(onReset).toHaveBeenCalled();
  });
});

describe("filter panel", () => {
  it("renders format toggles with counts and pressed state", () => {
    const { el, state, filter } = setup({
      availableFormats: [
        { name: "pdf", count: 273 },
        { name: "djvu", count: 128 },
      ],
      formats: ["djvu"],
    });
    filter.renderFilterPanel();

    const buttons = [...el.tfFormats.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["PDF273", "DJVU128"]);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(state.formats).toEqual(["djvu"]);
  });

  it("toggles a format and reloads the catalogue", () => {
    const { el, state, filter, filtersChanged } = setup({
      availableFormats: [{ name: "pdf", count: 3 }],
    });
    filter.renderFilterPanel();

    el.tfFormats.querySelector<HTMLElement>("button")?.click();
    expect(state.formats).toEqual(["pdf"]);
    expect(filtersChanged).toHaveBeenCalled();

    el.tfFormats.querySelector<HTMLElement>("button")?.click();
    expect(state.formats).toEqual([]);
  });

  it("lists the dictionary with counts and checks active tags", () => {
    const { el, filter } = setup({
      availableTags: [
        makeTag({ id: 1, name: "Платон", kind: "person", count: 4 }),
        makeTag({ id: 2, name: "Гегель", kind: "person", count: 0 }),
      ],
      tags: ["Гегель"],
    });
    filter.renderFilterPanel();

    const rows = [...el.tfList.querySelectorAll(".check-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toBe("Платон · person4");
    const inputs = [...el.tfList.querySelectorAll<HTMLInputElement>("input")];
    expect(inputs[0]?.checked).toBe(false);
    expect(inputs[1]?.checked).toBe(true);
  });

  it("filters the dictionary by name and alias", () => {
    const { el, filter } = setup({
      availableTags: [
        makeTag({ id: 1, name: "Платон", aliases: ["платонизм"] }),
        makeTag({ id: 2, name: "Гегель", aliases: ["немецкий идеализм"] }),
      ],
    });
    filter.renderFilterPanel();

    el.tfSearch.value = "ИДЕАЛИЗМ";
    filter.renderFilterList();
    expect([...el.tfList.querySelectorAll(".check-row")].map((row) => row.textContent)).toEqual([
      "Гегель · person0",
    ]);
  });

  it("explains an empty dictionary and an empty search", () => {
    const empty = setup();
    empty.filter.renderFilterPanel();
    expect(empty.el.tfList.textContent).toBe("Тегов пока нет");

    const noMatch = setup({ availableTags: [makeTag({ name: "Платон" })] });
    noMatch.el.tfSearch.value = "аристотель";
    noMatch.filter.renderFilterPanel();
    expect(noMatch.el.tfList.textContent).toBe("Ничего не найдено");
  });

  it("toggles a tag from the checkbox row and reloads", () => {
    const { el, state, filter, reloadBooks } = setup({
      availableTags: [makeTag({ name: "Платон" })],
    });
    filter.renderFilterPanel();
    const input = el.tfList.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(state.tags).toEqual(["Платон"]);
    expect(reloadBooks).toHaveBeenCalled();

    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(state.tags).toEqual([]);
  });
});

describe("filter dialog wiring", () => {
  it("opens the panel with a clean search and prevents implicit submits", () => {
    const { el, state, filter, reloadBooks } = setup({
      availableTags: [makeTag({ name: "Платон" })],
    });
    filter.bind();

    el.tfSearch.value = "старый поиск";
    el.filtersBtn.click();

    expect(el.tagfilter.open).toBe(true);
    expect(el.tfSearch.value).toBe("");
    expect(el.tfList.querySelectorAll(".check-row")).toHaveLength(1);

    const submit = new Event("submit", { bubbles: true, cancelable: true });
    el.tfForm.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);

    el.tfClear.click();
    expect(state.tags).toEqual([]);
    expect(state.formats).toEqual([]);
    expect(reloadBooks).not.toHaveBeenCalled();
  });

  it("closes on both the close and done buttons", () => {
    const { el, filter } = setup();
    filter.bind();
    el.filtersBtn.click();
    el.tfClose.click();
    expect(el.tagfilter.open).toBe(false);

    el.filtersBtn.click();
    el.tfDone.click();
    expect(el.tagfilter.open).toBe(false);
  });
});

describe("applyTagFilter", () => {
  it("replaces the tag filter with the clicked tag", () => {
    const { state, filter, filtersChanged } = setup({ tags: ["a", "b"] });
    filter.applyTagFilter("Гегель");
    expect(state.tags).toEqual(["Гегель"]);
    expect(filtersChanged).toHaveBeenCalled();
  });
});
