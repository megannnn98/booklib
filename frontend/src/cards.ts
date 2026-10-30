// Сетка и список карточек: чистый рендер по state, без сетевых вызовов.
// Основной клик по карточке разводится по роли клиента (ADR 0001):
// host desktop открывает папку в nemo, все остальные — лист форматов.

import type { CatalogState } from "./catalog_state";
import { bookMeta, bytesLabel } from "./catalog_state";
import { make, svgIcon } from "./dom";
import { renderTagChips } from "./tag_chips";
import type { BookDto } from "./types";
import { placeholderHue } from "./ui_helpers";

export interface CardsDeps {
  doc: Document;
  state: CatalogState;
  openDetails(book: BookDto): void;
  editBook(book: BookDto): void;
  openBook(book: BookDto): void;
  openFiles(book: BookDto): void;
  applyTagFilter(name: string): void;
  sortBy(sort: string): void;
}

export interface Cards {
  coverNode(book: BookDto): HTMLElement;
  cardNode(book: BookDto): HTMLElement;
  rowNode(book: BookDto): HTMLElement;
  listHeadNode(): HTMLElement;
  renderBookNodes(books: readonly BookDto[]): HTMLElement[];
  skeletonNodes(count: number): HTMLElement[];
  stateNode(
    title: string,
    text: string,
    actionLabel: string | null,
    action: (() => void) | null,
  ): HTMLElement;
}

export function createCards(deps: CardsDeps): Cards {
  const { doc, state } = deps;

  function coverNode(book: BookDto): HTMLElement {
    if (book.has_cover) {
      const img = doc.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = "";
      img.src = `/api/cover?key=${encodeURIComponent(book.key)}`;
      return img;
    }
    const placeholder = make(doc, "div", "placeholder");
    placeholder.style.setProperty("--ph-hue", String(placeholderHue(book.title)));
    const top = make(doc, "div");
    top.append(make(doc, "div", "ph-title", book.title));
    if (book.author) {
      top.append(make(doc, "div", "ph-author", book.author));
    }
    const format = book.formats[0] ?? book.kind;
    placeholder.append(top, make(doc, "span", "ph-format", format.toUpperCase()));
    return placeholder;
  }

  function formatsNode(book: BookDto): HTMLElement {
    const formats = make(doc, "div", "formats");
    formats.append(
      ...book.formats.slice(0, 4).map((format) => {
        const item = make(doc, "i", "", format);
        item.dataset.format = format;
        return item;
      }),
    );
    return formats;
  }

  function actionsNode(book: BookDto): HTMLElement {
    const actions = make(doc, "div", "card-actions");

    const info = make(doc, "button", "icon-btn info");
    info.type = "button";
    info.title = "Подробнее";
    info.setAttribute("aria-label", `Подробнее: ${book.title}`);
    info.append(svgIcon(doc, "info"));
    info.onclick = (event) => {
      // иначе клик уйдёт в карточку и откроет папку/форматы
      event.stopPropagation();
      deps.openDetails(book);
    };
    actions.append(info);

    if (state.local) {
      const edit = make(doc, "button", "icon-btn edit");
      edit.type = "button";
      edit.title = "Править название, автора, раздел";
      edit.setAttribute("aria-label", `Править: ${book.title}`);
      edit.append(svgIcon(doc, "edit"));
      edit.onclick = (event) => {
        // иначе клик уйдёт в карточку и откроет папку/форматы
        event.stopPropagation();
        deps.editBook(book);
      };
      actions.append(edit);
    }

    return actions;
  }

  function primaryAction(node: HTMLElement, book: BookDto): void {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute(
      "aria-label",
      state.hostDesktop
        ? `${book.title} — открыть в папке`
        : `${book.title} — выбрать формат для скачивания`,
    );
    // Семантика основного клика по роли: хост — папка в nemo, иначе — лист форматов.
    node.onclick = () => (state.hostDesktop ? deps.openBook(book) : deps.openFiles(book));
    node.onkeydown = (event) => {
      if (event.target !== node) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        node.click();
      }
    };
  }

  function cardTagsNode(book: BookDto): HTMLElement | null {
    if (!book.tags.length) {
      return null;
    }
    const tagsBox = make(doc, "div", "tags");
    renderTagChips(doc, tagsBox, book.tags.slice(0, 3), {
      onClick: (tag) => deps.applyTagFilter(tag.name),
    });
    if (book.tags.length > 3) {
      tagsBox.append(make(doc, "span", "tag-more", `+${book.tags.length - 3}`));
    }
    return tagsBox;
  }

  function cardNode(book: BookDto): HTMLElement {
    const card = make(doc, "article", "card");
    card.title = book.title;

    const thumb = make(doc, "div", "thumb");
    thumb.append(coverNode(book), actionsNode(book));
    if (book.edited) {
      thumb.append(make(doc, "div", "edited", "правлено"));
    }

    const body = make(doc, "div", "card-body");
    body.append(make(doc, "div", "title", book.title));
    body.append(make(doc, "div", "meta", bookMeta(book)));
    body.append(formatsNode(book));
    const tagsBox = cardTagsNode(book);
    if (tagsBox) {
      body.append(tagsBox);
    }

    card.append(thumb, body);
    primaryAction(card, book);
    return card;
  }

  function rowNode(book: BookDto): HTMLElement {
    const row = make(doc, "article", "row");
    row.title = book.title;

    const thumb = make(doc, "div", "thumb");
    thumb.append(coverNode(book));

    const main = make(doc, "div", "c-main");
    const title = make(doc, "div", "title", book.title);
    if (book.edited) {
      title.append(make(doc, "span", "edited", "правлено"));
    }
    main.append(title);
    if (book.author) {
      main.append(make(doc, "div", "sub m-extra", book.author));
    }

    const formats = make(doc, "div", "c-formats");
    formats.append(formatsNode(book), make(doc, "span", "m-extra", bytesLabel(book.size_mb)));

    row.append(
      thumb,
      main,
      make(doc, "div", "cell c-author", book.author || "—"),
      make(doc, "div", "cell c-section", book.section || "—"),
      formats,
      make(doc, "div", "cell c-size num", bytesLabel(book.size_mb)),
      actionsNode(book),
    );
    primaryAction(row, book);
    return row;
  }

  function listHeadNode(): HTMLElement {
    const head = make(doc, "div", "list-head");
    const sortable = (label: string, sort: string): HTMLButtonElement => {
      const button = make(doc, "button", "", label);
      button.type = "button";
      button.setAttribute("aria-pressed", String(state.sort === sort));
      button.onclick = () => deps.sortBy(sort);
      return button;
    };
    const size = make(doc, "div", "num");
    size.append(sortable("Размер", "size"));
    const title = make(doc, "div");
    title.append(sortable("Название", "title"));
    head.append(
      make(doc, "div"),
      title,
      make(doc, "div", "", "Автор"),
      make(doc, "div", "", "Раздел"),
      make(doc, "div", "", "Форматы"),
      size,
      make(doc, "div"),
    );
    return head;
  }

  function renderBookNodes(books: readonly BookDto[]): HTMLElement[] {
    return books.map((book) => (state.view === "list" ? rowNode(book) : cardNode(book)));
  }

  function stateNode(
    title: string,
    text: string,
    actionLabel: string | null,
    action: (() => void) | null,
  ): HTMLElement {
    const box = make(doc, "div", "state");
    box.append(make(doc, "h3", "", title), make(doc, "div", "", text));
    if (actionLabel && action) {
      const button = make(doc, "button", "btn", actionLabel);
      button.type = "button";
      button.onclick = action;
      box.append(button);
    }
    return box;
  }

  function skeletonNodes(count: number): HTMLElement[] {
    return Array.from({ length: count }, () => {
      const card = make(doc, "div", "card skeleton");
      card.append(make(doc, "div", "thumb"));
      return card;
    });
  }

  return {
    coverNode,
    cardNode,
    rowNode,
    listHeadNode,
    renderBookNodes,
    skeletonNodes,
    stateNode,
  };
}
