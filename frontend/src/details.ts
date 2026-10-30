// Подробности книги: отдельная кнопка «i» на карточке. Основной клик по
// карточке по-прежнему открывает папку (host desktop) или лист форматов.

import { bytesLabel } from "./catalog_state";
import type { CatalogState } from "./catalog_state";
import type { Cards } from "./cards";
import { make, svgIcon, type Elements } from "./dom";
import { renderTagChips } from "./tag_chips";
import type { BookDto } from "./types";

export interface DetailsDeps {
  doc: Document;
  el: Elements;
  state: CatalogState;
  cards: Pick<Cards, "coverNode">;
  openBook(book: BookDto): void;
  editBook(book: BookDto): void;
  applyTagFilter(name: string): void;
  fillFiles(container: HTMLElement, book: BookDto): Promise<void>;
}

export interface DetailsDialog {
  openDetails(book: BookDto): void;
}

export function createDetails(deps: DetailsDeps): DetailsDialog {
  const { doc, el, state } = deps;

  function props(book: BookDto): Array<[string, string]> {
    const rows: Array<[string, string]> = [
      ["Раздел", book.section || "—"],
      ["Год", book.year ? String(book.year) : "—"],
      ["Форматы", book.formats.map((format) => format.toUpperCase()).join(", ")],
      ["Размер", bytesLabel(book.size_mb)],
      ["Путь", book.key],
    ];
    if (book.edited) {
      rows.push(["Правки", "есть ручные правки"]);
    }
    return rows;
  }

  function openDetails(book: BookDto): void {
    el.dCover.replaceChildren(deps.cards.coverNode(book));
    el.dTitle.textContent = book.title;
    el.dAuthor.textContent = book.author || "автор не указан";
    el.dAuthor.hidden = false;

    el.dProps.replaceChildren(
      ...props(book).flatMap(([name, value]) => [
        make(doc, "dt", "", name),
        make(doc, "dd", "", value),
      ]),
    );
    if (book.tags.length) {
      const tagsBox = make(doc, "dd", "tags");
      renderTagChips(doc, tagsBox, book.tags, {
        onClick: (tag) => {
          el.details.close();
          deps.applyTagFilter(tag.name);
        },
      });
      el.dProps.append(make(doc, "dt", "", "Теги"), tagsBox);
    }

    const actions: HTMLButtonElement[] = [];
    if (state.hostDesktop) {
      const open = make(doc, "button", "btn primary", "Открыть в папке");
      open.type = "button";
      open.prepend(svgIcon(doc, "folder"));
      open.onclick = () => deps.openBook(book);
      actions.push(open);
    }
    if (state.local) {
      const edit = make(doc, "button", "btn", "Править");
      edit.type = "button";
      edit.prepend(svgIcon(doc, "edit"));
      edit.onclick = () => deps.editBook(book);
      actions.push(edit);
    }
    el.dActions.replaceChildren(...actions);
    el.dActions.hidden = !actions.length;

    el.details.showModal();
    el.dClose.focus();
    void deps.fillFiles(el.dFiles, book);
  }

  return { openDetails };
}
