import { describe, expect, it, vi } from "vitest";

import { createNav } from "../src/nav";
import { createState } from "../src/catalog_state";
import { findElements } from "../src/dom";
import { stubBackend } from "./helpers/backend";
import { mountPage } from "./helpers/page";

function setup(stateOverrides: Parameters<typeof createState>[1] = {}) {
  const doc = mountPage();
  const el = findElements(doc);
  const state = createState(null, stateOverrides);
  const backend = stubBackend();
  const filtersChanged = vi.fn();
  const closeNavOnMobile = vi.fn();
  const nav = createNav({
    doc,
    el,
    state,
    api: backend.api,
    filtersChanged,
    closeNavOnMobile,
  });
  return { doc, el, state, backend, nav, filtersChanged, closeNavOnMobile };
}

describe("section navigation", () => {
  it("renders sections with their counts and marks the active one", () => {
    const { el, state, nav } = setup({ section: "Математика" });
    state.sections = [
      { name: "Математика", count: 93 },
      { name: "История", count: 17 },
    ];

    nav.renderNav();

    const buttons = [...el.sections.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Математика93", "История17"]);
    expect(buttons[0]?.classList.contains("active")).toBe(true);
    expect(buttons[0]?.getAttribute("aria-current")).toBe("page");
    expect(buttons[1]?.classList.contains("active")).toBe(false);
    expect(buttons[1]?.hasAttribute("aria-current")).toBe(false);
    expect(buttons[0]?.title).toBe("Математика");
  });

  it("filters sections from the search field and shows the empty message", () => {
    const { el, state, nav } = setup();
    state.sections = [
      { name: "Математика", count: 93 },
      { name: "История", count: 17 },
    ];

    el.sectionSearch.value = "ист";
    nav.renderNav();
    expect([...el.sections.querySelectorAll(".label")].map((node) => node.textContent)).toEqual([
      "История",
    ]);

    el.sectionSearch.value = "физика";
    nav.renderNav();
    expect(el.sections.textContent).toBe("Раздел не найден");
  });

  it("selects the first match on Enter in the section search", () => {
    const { el, state, nav, filtersChanged } = setup();
    state.sections = [
      { name: "Математика", count: 93 },
      { name: "История", count: 17 },
    ];
    nav.bind();

    el.sectionSearch.value = "мат";
    el.sectionSearch.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(state.section).toBe("Математика");
    expect(filtersChanged).toHaveBeenCalled();
  });

  it("ignores Enter when nothing matches", () => {
    const { el, state, nav, filtersChanged } = setup();
    state.sections = [{ name: "История", count: 17 }];
    nav.bind();

    el.sectionSearch.value = "физика";
    el.sectionSearch.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(state.section).toBe("*");
    expect(filtersChanged).not.toHaveBeenCalled();
  });

  it("leaves the virtual recent order when a real section is picked", () => {
    const { el, state, nav, filtersChanged, closeNavOnMobile } = setup({ sort: "added" });
    state.sections = [{ name: "Математика", count: 93 }];
    nav.renderNav();

    el.sections.querySelector("button")?.click();

    expect(state.section).toBe("Математика");
    expect(state.sort).toBe("title");
    expect(el.sort.value).toBe("title");
    expect(closeNavOnMobile).toHaveBeenCalled();
    expect(filtersChanged).toHaveBeenCalled();
  });

  it("keeps a non-virtual sort order when a section is picked", () => {
    const { el, state, nav } = setup({ sort: "size" });
    state.sections = [{ name: "История", count: 17 }];
    nav.renderNav();
    el.sections.querySelector("button")?.click();
    expect(state.sort).toBe("size");
  });

  it("highlights the all/recent nav item from the state", () => {
    const { el, state, nav } = setup({ sort: "added", section: "*" });
    nav.renderNav();
    const items = [...el.sidebar.querySelectorAll<HTMLElement>(".nav-item[data-view]")];
    const all = items.find((item) => item.dataset.view === "all");
    const recent = items.find((item) => item.dataset.view === "recent");
    expect(recent?.classList.contains("active")).toBe(true);
    expect(all?.classList.contains("active")).toBe(false);

    state.sort = "title";
    nav.renderNav();
    expect(all?.classList.contains("active")).toBe(true);
    expect(recent?.classList.contains("active")).toBe(false);
  });

  it("switches to the recent view from the sidebar", () => {
    const { el, state, nav, filtersChanged } = setup();
    nav.bind();
    const recent = el.sidebar.querySelector<HTMLElement>('.nav-item[data-view="recent"]');
    recent?.click();
    expect(state.section).toBe("*");
    expect(state.sort).toBe("added");
    expect(filtersChanged).toHaveBeenCalled();
  });

  it("names the current view in the context bar", () => {
    const { el, state, nav } = setup();
    nav.renderNav();
    expect(el.viewTitle.textContent).toBe("Все книги");

    state.sort = "added";
    nav.renderNav();
    expect(el.viewTitle.textContent).toBe("Недавно добавленные");

    state.section = "Математика";
    nav.renderNav();
    expect(el.viewTitle.textContent).toBe("Математика");
  });
});

describe("loadSections", () => {
  it("fills the datalist and the total counter", async () => {
    const { el, state, nav, backend } = setup();
    backend.calls.length = 0;

    await nav.loadSections();

    expect(backend.find("GET", "/api/sections")).toBeDefined();
    expect(state.sections).toEqual([]);
    expect(el.totalCount.textContent).toBe("0");
    expect(el.sectionsList.querySelectorAll("option")).toHaveLength(0);
  });

  it("stores sections and sums their counts", async () => {
    const doc = mountPage();
    const el = findElements(doc);
    const backend = stubBackend({
      "/api/sections": [
        { name: "Математика", count: 93 },
        { name: "История", count: 17 },
      ],
    });
    const state = createState(null);
    const nav = createNav({
      doc,
      el,
      state,
      api: backend.api,
      filtersChanged: vi.fn(),
      closeNavOnMobile: vi.fn(),
    });

    await nav.loadSections();

    expect(state.sections).toHaveLength(2);
    expect(el.totalCount.textContent).toBe("110");
    expect([...el.sectionsList.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "Математика",
      "История",
    ]);
    expect(el.sections.querySelectorAll("button")).toHaveLength(2);
  });
});

describe("sort control", () => {
  it("reloads the catalogue when the sort changes", () => {
    const { el, state, nav, filtersChanged } = setup();
    nav.bind();

    el.sort.value = "size";
    el.sort.dispatchEvent(new Event("change"));

    expect(state.sort).toBe("size");
    expect(filtersChanged).toHaveBeenCalled();
  });

  it("sorts from the list head and syncs the select", () => {
    const { el, state, nav, filtersChanged } = setup();
    nav.selectSort("year");
    expect(state.sort).toBe("year");
    expect(el.sort.value).toBe("year");
    expect(filtersChanged).toHaveBeenCalled();
  });
});
