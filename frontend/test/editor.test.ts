import { describe, expect, it, vi } from "vitest";

import { createState } from "../src/catalog_state";
import { findElements } from "../src/dom";
import { createEditor } from "../src/editor";
import { createToast } from "../src/toast";
import { makeBook, makeBookTag, makeTag } from "./helpers/books";
import { stubBackend } from "./helpers/backend";
import { mountPage } from "./helpers/page";

function setup(availableTags = [makeTag()]) {
  const doc = mountPage();
  const el = findElements(doc);
  const state = createState(null, { availableTags });
  const backend = stubBackend();
  const loadTags = vi.fn(async () => {});
  const loadSections = vi.fn(async () => {});
  const loadBooks = vi.fn(async () => {});
  const toast = createToast(el, { after: () => 1, clear: () => {} });
  const editor = createEditor({
    doc,
    el,
    state,
    api: backend.api,
    toast,
    loadTags,
    loadSections,
    loadBooks,
  });
  return { doc, el, state, backend, editor, loadTags, loadSections, loadBooks };
}

function submit(form: HTMLFormElement, submitter?: HTMLButtonElement | null): Event {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  if (submitter !== undefined) {
    Object.defineProperty(event, "submitter", { value: submitter });
  }
  form.dispatchEvent(event);
  return event;
}

describe("editor dialog", () => {
  it("prefills the card fields and its tags", () => {
    const { el, state, editor } = setup();
    editor.editBook(
      makeBook({
        key: "math/Анализ",
        title: "Анализ",
        author: "Фихтенгольц",
        section: "Математика",
        tags: [makeBookTag({ name: "Платон" })],
      }),
    );

    expect(el.editor.open).toBe(true);
    expect(el.editor.returnValue).toBe("cancel");
    expect(el.eKey.textContent).toBe("math/Анализ");
    expect(el.eTitle.value).toBe("Анализ");
    expect(el.eAuthor.value).toBe("Фихтенгольц");
    expect(el.eSection.value).toBe("Математика");
    expect(el.eTagInput.value).toBe("");
    expect(state.editorTags.map((tag) => tag.name)).toEqual(["Платон"]);
    expect([...el.eTags.querySelectorAll(".tag-chip")].map((chip) => chip.textContent)).toEqual([
      "Платон✕",
    ]);
    expect([...el.tagsList.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "Платон",
    ]);
  });

  it("closes the details drawer before opening the editor", () => {
    const { el, editor } = setup();
    el.details.showModal();
    editor.editBook(makeBook());
    expect(el.details.open).toBe(false);
  });

  it("saves the edited card and refreshes the catalogue", async () => {
    const { el, backend, editor, loadTags, loadSections, loadBooks } = setup();
    editor.editBook(makeBook({ tags: [makeBookTag({ name: "Платон" })] }));
    el.eTitle.value = "Новое название";
    el.eAuthor.value = "Новый автор";
    el.eSection.value = "История";

    const event = submit(el.eForm, el.eSave);
    expect(event.defaultPrevented).toBe(true);

    await vi.waitFor(() => expect(backend.count("POST", "/api/book")).toBe(1));
    expect(backend.find("POST", "/api/book")?.body).toEqual({
      key: "math/Анализ",
      title: "Новое название",
      author: "Новый автор",
      section: "История",
      tags: ["Платон"],
    });
    expect(el.editor.open).toBe(false);
    await vi.waitFor(() => expect(el.toast.textContent).toBe("Сохранено"));
    await vi.waitFor(() => {
      expect(loadTags).toHaveBeenCalled();
      expect(loadSections).toHaveBeenCalled();
      expect(loadBooks).toHaveBeenCalled();
    });
  });

  it("treats an implicit submit as save", async () => {
    const { el, backend, editor } = setup();
    editor.editBook(makeBook());

    const event = submit(el.eForm, null);

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(backend.count("POST", "/api/book")).toBe(1));
  });

  it("does nothing when the dialog is cancelled", async () => {
    const { el, backend, editor } = setup();
    editor.editBook(makeBook());
    el.editor.close("cancel");
    await Promise.resolve();
    expect(backend.count("POST", "/api/book")).toBe(0);
  });

  it("ignores a submit from a non-save button", () => {
    const { el, editor } = setup();
    editor.editBook(makeBook());
    const cancel = el.eForm.querySelector<HTMLButtonElement>('button[value="cancel"]')!;

    const event = submit(el.eForm, cancel);

    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps the dialog open when the typed tag is unknown", async () => {
    const { el, backend, editor } = setup();
    editor.editBook(makeBook());
    el.eTagInput.value = "Неизвестный";

    submit(el.eForm, el.eSave);

    expect(el.editor.open).toBe(true);
    expect(el.toast.textContent).toBe("Нет такого тега: Неизвестный");
    expect(el.toast.classList.contains("error")).toBe(true);
    expect(backend.count("POST", "/api/book")).toBe(0);
  });

  it("resets the manual edits from the dialog", async () => {
    const { el, backend, editor } = setup();
    editor.editBook(makeBook());

    el.editor.close("reset");

    await vi.waitFor(() => expect(backend.count("POST", "/api/book")).toBe(1));
    expect(backend.find("POST", "/api/book")?.body).toEqual({ key: "math/Анализ", reset: true });
    await vi.waitFor(() => expect(el.toast.textContent).toBe("Правки сброшены"));
  });

  it("reports a failed save and keeps the catalogue as is", async () => {
    const { el, backend, loadBooks } = setup();
    backend.calls.length = 0;
    const failing = stubBackend({
      "/api/book": () => {
        throw new Error("нет такой карточки");
      },
    });
    const strict = createEditor({
      doc: el.editor.ownerDocument,
      el,
      state: createState(null, { availableTags: [] }),
      api: failing.api,
      toast: createToast(el, { after: () => 1, clear: () => {} }),
      loadTags: vi.fn(async () => {}),
      loadSections: vi.fn(async () => {}),
      loadBooks,
    });
    strict.editBook(makeBook());

    el.editor.close("save");

    await vi.waitFor(() =>
      expect(el.toast.textContent).toBe("Не сохранилось: нет такой карточки"),
    );
    expect(loadBooks).not.toHaveBeenCalled();
  });
});

describe("editor tag input", () => {
  it("adds a known tag from the button and clears the input", () => {
    const { el, state, editor } = setup([makeTag({ name: "Гегель", aliases: ["немецкий идеализм"] })]);
    editor.editBook(makeBook());
    el.eTagInput.value = "НЕМЕЦКИЙ ИДЕАЛИЗМ";

    el.eTagAdd.click();

    expect(state.editorTags.map((tag) => tag.name)).toEqual(["Гегель"]);
    expect(el.eTagInput.value).toBe("");
    expect([...el.eTags.querySelectorAll(".tag-chip")].map((chip) => chip.textContent)).toEqual([
      "Гегель✕",
    ]);
  });

  it("does nothing for a blank input", () => {
    const { el, state, editor } = setup();
    editor.editBook(makeBook());
    el.eTagInput.value = "   ";

    el.eTagAdd.click();

    expect(state.editorTags).toEqual([]);
    expect(el.toast.textContent ?? "").toBe("");
  });

  it("adds a tag on Enter without submitting the form", () => {
    const { el, state, editor } = setup();
    editor.editBook(makeBook());
    el.eTagInput.value = "Платон";

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.eTagInput.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(state.editorTags.map((tag) => tag.name)).toEqual(["Платон"]);
  });

  it("removes a tag chip", () => {
    const { el, state, editor } = setup([
      makeTag({ id: 1, name: "Платон" }),
      makeTag({ id: 2, name: "Гегель" }),
    ]);
    editor.editBook(makeBook());
    el.eTagInput.value = "Платон";
    el.eTagAdd.click();
    el.eTagInput.value = "Гегель";
    el.eTagAdd.click();

    el.eTags.querySelector<HTMLElement>(".tag-x")?.click();

    expect(state.editorTags.map((tag) => tag.name)).toEqual(["Гегель"]);
  });

  it("sends the current tag set with the save", async () => {
    const { el, backend, editor } = setup([makeTag({ name: "Платон" })]);
    editor.editBook(makeBook());
    el.eTagInput.value = "Платон";
    el.eTagAdd.click();

    submit(el.eForm, el.eSave);

    await vi.waitFor(() => expect(backend.count("POST", "/api/book")).toBe(1));
    expect(backend.find("POST", "/api/book")?.body).toMatchObject({ tags: ["Платон"] });
  });
});
