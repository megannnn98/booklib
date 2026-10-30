// Чипы активных фильтров, панель «Форматы/Теги» и её диалог.

import type { CatalogState } from "./catalog_state";
import { clearPanelFilters, removeChip, toggleFormat } from "./catalog_state";
import { make, type Elements } from "./dom";
import { activeFilters } from "./ui_helpers";

export interface TagFilterDeps {
  doc: Document;
  el: Elements;
  state: CatalogState;
  /** Перерисовать чипы, панель и перезагрузить каталог. */
  filtersChanged(): void;
  /** Перезагрузить каталог без перерисовки панели (чекбокс уже актуален). */
  reloadBooks(): void;
  /** «Сбросить всё» — логика живёт в app: там же навигация по разделу. */
  onReset(): void;
}

export interface TagFilter {
  bind(): void;
  renderChips(): void;
  renderFilterPanel(): void;
  renderFilterList(): void;
  applyTagFilter(name: string): void;
}

export function createTagFilter(deps: TagFilterDeps): TagFilter {
  const { doc, el, state } = deps;

  function renderChips(): void {
    const chips = activeFilters(state);
    const panelCount = state.tags.length + state.formats.length;
    el.filtersBadge.hidden = panelCount === 0;
    el.filtersBadge.textContent = String(panelCount);

    if (!chips.length) {
      el.chips.replaceChildren();
      return;
    }

    const nodes = chips.map((chip) => {
      const button = make(doc, "button", "chip", chip.label);
      button.type = "button";
      button.title = "Убрать фильтр";
      button.append(make(doc, "span", "x", "✕"));
      button.onclick = () => {
        removeChip(state, chip);
        deps.filtersChanged();
      };
      return button;
    });

    const reset = make(doc, "button", "chip reset", "Сбросить всё");
    reset.type = "button";
    reset.onclick = deps.onReset;
    el.chips.replaceChildren(...nodes, reset);
  }

  function renderFilterList(): void {
    const term = el.tfSearch.value.trim().toLowerCase();
    const rows = state.availableTags.filter((tag) => {
      if (!term) {
        return true;
      }
      return (
        tag.name.toLowerCase().includes(term) ||
        tag.aliases.some((alias) => alias.toLowerCase().includes(term))
      );
    });

    if (!rows.length) {
      el.tfList.replaceChildren(
        make(
          doc,
          "div",
          "state",
          state.availableTags.length ? "Ничего не найдено" : "Тегов пока нет",
        ),
      );
      return;
    }

    el.tfList.replaceChildren(
      ...rows.map((tag) => {
        const row = make(doc, "label", "check-row");
        const input = doc.createElement("input");
        input.type = "checkbox";
        input.checked = state.tags.includes(tag.name);
        input.onchange = () => {
          if (input.checked) {
            if (!state.tags.includes(tag.name)) {
              state.tags.push(tag.name);
            }
          } else {
            state.tags = state.tags.filter((name) => name !== tag.name);
          }
          renderChips();
          deps.reloadBooks();
        };
        row.append(
          input,
          make(doc, "span", "", `${tag.name} · ${tag.kind}`),
          make(doc, "span", "count", tag.count),
        );
        return row;
      }),
    );
  }

  function renderFilterPanel(): void {
    el.tfFormats.replaceChildren(
      ...state.availableFormats.map((item) => {
        const button = make(doc, "button", "", item.name.toUpperCase());
        button.type = "button";
        button.setAttribute("aria-pressed", String(state.formats.includes(item.name)));
        button.append(make(doc, "span", "count", item.count));
        button.onclick = () => {
          toggleFormat(state, item.name);
          deps.filtersChanged();
        };
        return button;
      }),
    );
    renderFilterList();
  }

  function applyTagFilter(name: string): void {
    state.tags = [name];
    deps.filtersChanged();
  }

  function bind(): void {
    el.filtersBtn.addEventListener("click", () => {
      el.tfSearch.value = "";
      renderFilterPanel();
      el.tagfilter.showModal();
    });
    el.tfSearch.addEventListener("input", renderFilterList);
    // Форма — только контейнер разметки. Без method="dialog" Enter в единственном
    // текстовом поле уходит implicit submit'ом в GET на текущий URL и
    // перезагружает витрину.
    el.tfForm.addEventListener("submit", (event) => event.preventDefault());
    el.tfClear.addEventListener("click", () => {
      clearPanelFilters(state);
      deps.filtersChanged();
    });
    el.tfClose.addEventListener("click", () => el.tagfilter.close());
    el.tfDone.addEventListener("click", () => el.tagfilter.close());
  }

  return { bind, renderChips, renderFilterPanel, renderFilterList, applyTagFilter };
}
