// Редактор карточки: название, автор, раздел и набор тегов. Форма объявлена
// с method="dialog", поэтому submit кнопкой — это закрытие диалога с её
// value, а Enter в поле (implicit submit) — ветка «Сохранить». Текст,
// набранный в поле тега, добавляется ДО закрытия: иначе тег теряется.

import type { ApiClient } from "./api";
import type { CatalogState } from "./catalog_state";
import type { Elements } from "./dom";
import { renderTagChips } from "./tag_chips";
import type { Toast } from "./toast";
import {
  addEditorTagFromInput,
  normalizeTagName,
  resolveEditorSubmitAction,
} from "./tag_helpers";
import type { BookDto, EditBookPayload, EditBookResult } from "./types";

export interface EditorDeps {
  doc: Document;
  el: Elements;
  state: CatalogState;
  api: ApiClient;
  toast: Toast;
  loadTags(): Promise<void>;
  loadSections(): Promise<void>;
  loadBooks(): Promise<void>;
}

export interface EditorDialog {
  editBook(book: BookDto): void;
  renderEditorTags(): void;
  renderTagDatalist(): void;
  tryAddEditorTag(value: string): boolean;
}

export function createEditor(deps: EditorDeps): EditorDialog {
  const { doc, el, state } = deps;

  function renderTagDatalist(): void {
    el.tagsList.replaceChildren(
      ...state.availableTags.map((tag) => {
        const option = doc.createElement("option");
        option.value = tag.name;
        return option;
      }),
    );
  }

  function renderEditorTags(): void {
    renderTagChips(doc, el.eTags, state.editorTags, {
      onRemove: (tag) => {
        state.editorTags = state.editorTags.filter((item) => item.name !== tag.name);
        renderEditorTags();
      },
    });
  }

  function tryAddEditorTag(value: string): boolean {
    const result = addEditorTagFromInput(state.availableTags, state.editorTags, value);
    if (result.error) {
      deps.toast.show(result.error, true);
      return false;
    }
    state.editorTags = [...result.editorTags];
    el.eTagInput.value = result.inputValue;
    if (result.added) {
      renderEditorTags();
    }
    return true;
  }

  function currentTagNames(): string[] {
    return state.editorTags.map((tag) => tag.name);
  }

  async function save(action: string, book: BookDto): Promise<void> {
    try {
      const payload: EditBookPayload =
        action === "reset"
          ? { key: book.key, reset: true }
          : {
              key: book.key,
              title: el.eTitle.value,
              author: el.eAuthor.value,
              section: el.eSection.value,
              tags: currentTagNames(),
            };
      const result = await deps.api.send<EditBookResult>("/api/book", "POST", payload);
      deps.toast.show(result.action === "reset" ? "Правки сброшены" : "Сохранено");
      await Promise.all([deps.loadTags(), deps.loadSections(), deps.loadBooks()]);
    } catch (error) {
      deps.toast.show(`Не сохранилось: ${(error as Error).message}`, true);
    }
  }

  function editBook(book: BookDto): void {
    if (el.details.open) {
      el.details.close();
    }
    el.eKey.textContent = book.key;
    el.eTitle.value = book.title || "";
    el.eAuthor.value = book.author || "";
    el.eSection.value = book.section || "";
    el.eTagInput.value = "";
    state.editorTags = [...book.tags];
    renderEditorTags();
    renderTagDatalist();
    el.editor.returnValue = "cancel";
    el.editor.showModal();

    el.editor.onclose = () => {
      const action = el.editor.returnValue;
      if (action !== "save" && action !== "reset") {
        return;
      }
      void save(action, book);
    };
  }

  function bind(): void {
    el.eTagAdd.addEventListener("click", () => {
      const value = normalizeTagName(el.eTagInput.value);
      if (!value) {
        return;
      }
      tryAddEditorTag(value);
    });

    el.eTagInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        // Иначе Enter уйдёт implicit submit'ом формы и закроет диалог.
        event.preventDefault();
        el.eTagAdd.click();
      }
    });

    el.eForm.addEventListener("submit", (event) => {
      const action = resolveEditorSubmitAction(event);
      if (action !== "save") {
        return;
      }
      event.preventDefault();
      if (!tryAddEditorTag(el.eTagInput.value)) {
        return;
      }
      el.editor.close("save");
    });
  }

  bind();

  return { editBook, renderEditorTags, renderTagDatalist, tryAddEditorTag };
}
