// Навигация по разделам и сортировка: список слева, поиск по разделам,
// виртуальные «Все книги» / «Недавно добавленные».

import type { ApiClient } from "./api";
import type { CatalogState } from "./catalog_state";
import { sectionSort, viewName } from "./catalog_state";
import { make, type Elements } from "./dom";
import type { SectionDto } from "./types";
import { filterSections } from "./ui_helpers";

export interface NavDeps {
  doc: Document;
  el: Elements;
  state: CatalogState;
  api: ApiClient;
  filtersChanged(): void;
  closeNavOnMobile(): void;
}

export interface Nav {
  bind(): void;
  renderNav(): void;
  selectSection(section: string, sort: string): void;
  selectSort(sort: string): void;
  loadSections(): Promise<void>;
}

export function createNav(deps: NavDeps): Nav {
  const { doc, el, state } = deps;

  function renderNav(): void {
    const visible = filterSections(state.sections, el.sectionSearch.value);
    if (!visible.length && el.sectionSearch.value.trim()) {
      el.sections.replaceChildren(make(doc, "div", "empty", "Раздел не найден"));
    } else {
      el.sections.replaceChildren(
        ...visible.map((item) => {
          const button = make(doc, "button");
          button.type = "button";
          button.title = item.name;
          button.append(
            make(doc, "span", "label", item.name),
            make(doc, "span", "count", item.count),
          );
          button.classList.toggle("active", state.section === item.name);
          if (state.section === item.name) {
            button.setAttribute("aria-current", "page");
          }
          button.onclick = () => selectSection(item.name, sectionSort(state.sort));
          return button;
        }),
      );
    }

    for (const node of el.sidebar.querySelectorAll<HTMLElement>(".nav-item[data-view]")) {
      const active =
        state.section === "*" && (node.dataset.view === "recent") === (state.sort === "added");
      node.classList.toggle("active", active);
    }

    el.viewTitle.textContent = viewName(state);
  }

  function selectSection(section: string, sort: string): void {
    state.section = section;
    state.sort = sort;
    el.sort.value = state.sort;
    deps.closeNavOnMobile();
    renderNav();
    deps.filtersChanged();
  }

  function selectSort(sort: string): void {
    state.sort = sort;
    el.sort.value = sort;
    renderNav();
    deps.filtersChanged();
  }

  function bind(): void {
    el.sort.addEventListener("change", () => {
      selectSort(el.sort.value);
    });

    el.sectionSearch.addEventListener("input", renderNav);
    el.sectionSearch.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      const first = filterSections(state.sections, el.sectionSearch.value)[0];
      if (first) {
        selectSection(first.name, sectionSort(state.sort));
      }
    });

    for (const node of el.sidebar.querySelectorAll<HTMLElement>(".nav-item[data-view]")) {
      node.addEventListener("click", () => {
        selectSection("*", node.dataset.view === "recent" ? "added" : "title");
      });
    }
  }

  async function loadSections(): Promise<void> {
    const sections = await deps.api.get<SectionDto[]>("/api/sections");
    state.sections = sections;
    el.sectionsList.replaceChildren(
      ...sections.map((item) => {
        const option = doc.createElement("option");
        option.value = item.name;
        return option;
      }),
    );
    el.totalCount.textContent = String(sections.reduce((sum, item) => sum + item.count, 0));
    renderNav();
  }

  return { bind, renderNav, selectSection, selectSort, loadSections };
}
