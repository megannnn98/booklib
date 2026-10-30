// Каталог: загрузка страниц, состояние «ничего не найдено», скелетоны и
// подгрузка «Показать ещё». Сетку рисует cards.ts, запросы — api.ts.

import type { ApiClient } from "./api";
import type { CatalogState } from "./catalog_state";
import { moreLabel, plural, restCount } from "./catalog_state";
import type { Cards } from "./cards";
import type { Elements } from "./dom";
import type { Toast } from "./toast";
import type { BooksResponse } from "./types";
import { activeFilters, buildBooksQuery } from "./ui_helpers";

export interface CatalogDeps {
  doc: Document;
  el: Elements;
  state: CatalogState;
  api: ApiClient;
  cards: Cards;
  toast: Toast;
  pageSize: number;
  onResetFilters(): void;
}

export interface Catalog {
  loadBooks(): Promise<void>;
  loadMoreBooks(): Promise<void>;
  renderCatalog(): void;
  renderCounter(): void;
  renderMore(): void;
}

export function createCatalog(deps: CatalogDeps): Catalog {
  const { el, state, cards } = deps;

  function renderCounter(): void {
    el.counter.textContent = state.total
      ? `${state.total} ${plural(state.total, "книга", "книги", "книг")}`
      : "";
  }

  function renderMore(): void {
    el.more.hidden = restCount(state) <= 0;
    el.moreBtn.disabled = false;
    const label = moreLabel(state, deps.pageSize);
    if (label) {
      el.moreBtn.textContent = label;
    }
  }

  function renderCatalog(): void {
    el.grid.className = state.view === "list" ? "view-list" : "view-grid";
    el.grid.classList.toggle("compact", state.view === "grid" && state.density === "compact");

    if (!state.books.length) {
      const hasFilters = activeFilters(state).length > 0;
      el.grid.replaceChildren(
        cards.stateNode(
          "Ничего не найдено",
          hasFilters
            ? "Попробуйте ослабить фильтры или изменить запрос."
            : "Каталог пуст — запустите скан.",
          hasFilters ? "Сбросить фильтры" : null,
          hasFilters ? deps.onResetFilters : null,
        ),
      );
    } else {
      const nodes = cards.renderBookNodes(state.books);
      el.grid.replaceChildren(
        ...(state.view === "list" ? [cards.listHeadNode(), ...nodes] : nodes),
      );
    }
    renderMore();
  }

  function renderSkeleton(): void {
    if (state.view !== "grid" || state.books.length) {
      return;
    }
    el.grid.className = "view-grid";
    el.grid.replaceChildren(...cards.skeletonNodes(12));
  }

  async function loadBooks(): Promise<void> {
    const sequence = (state.requestSeq += 1);
    // Пока первая страница нового запроса в пути, «ещё» блокируется: иначе
    // подгрузка взяла бы offset старого списка с новыми фильтрами и после ответа
    // дописала бы в новый список страницу с пропуском или дублями.
    el.moreBtn.disabled = true;
    renderSkeleton();
    try {
      const data = await deps.api.get<BooksResponse>(
        `/api/books?${buildBooksQuery(state, 0, deps.pageSize)}`,
      );
      if (sequence !== state.requestSeq) {
        return;
      }
      state.books = data.books;
      state.total = data.total;
      renderCounter();
      renderCatalog();
    } catch (error) {
      if (sequence !== state.requestSeq) {
        return;
      }
      state.books = [];
      state.total = 0;
      renderCounter();
      el.more.hidden = true;
      el.grid.className = "view-grid";
      el.grid.replaceChildren(
        cards.stateNode("Каталог не загрузился", (error as Error).message, "Повторить", () => {
          void loadBooks();
        }),
      );
    }
  }

  async function loadMoreBooks(): Promise<void> {
    if (el.moreBtn.disabled || state.books.length >= state.total) {
      return;
    }
    const sequence = state.requestSeq;
    el.moreBtn.disabled = true;
    el.moreBtn.textContent = "Загружаю…";
    try {
      const data = await deps.api.get<BooksResponse>(
        `/api/books?${buildBooksQuery(state, state.books.length, deps.pageSize)}`,
      );
      if (sequence !== state.requestSeq) {
        return;
      }
      state.books = state.books.concat(data.books);
      state.total = data.total;
      el.grid.append(...cards.renderBookNodes(data.books));
      renderCounter();
      renderMore();
    } catch (error) {
      if (sequence !== state.requestSeq) {
        return;
      }
      deps.toast.show(`Не удалось загрузить ещё: ${(error as Error).message}`, true);
      renderMore();
    }
  }

  return { loadBooks, loadMoreBooks, renderCatalog, renderCounter, renderMore };
}
