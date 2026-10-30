import { describe, expect, it, vi } from "vitest";

import { createCards } from "../src/cards";
import { createState } from "../src/catalog_state";
import { makeBook, makeBookTag } from "./helpers/books";
import { mountPage } from "./helpers/page";

function setup(stateOverrides: Parameters<typeof createState>[1] = {}) {
  const doc = mountPage();
  const state = createState(null, stateOverrides);
  const deps = {
    doc,
    state,
    openDetails: vi.fn(),
    editBook: vi.fn(),
    openBook: vi.fn(),
    openFiles: vi.fn(),
    applyTagFilter: vi.fn(),
    sortBy: vi.fn(),
  };
  return { doc, state, deps, cards: createCards(deps) };
}

describe("card cover", () => {
  it("loads the real cover lazily", () => {
    const { cards } = setup();
    const node = cards.cardNode(makeBook({ key: "math/Анализ и синтез" }));
    const img = node.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/api/cover?key=math%2F%D0%90%D0%BD%D0%B0%D0%BB%D0%B8%D0%B7%20%D0%B8%20%D1%81%D0%B8%D0%BD%D1%82%D0%B5%D0%B7");
    expect(img?.loading).toBe("lazy");
    expect(img?.decoding).toBe("async");
    expect(img?.alt).toBe("");
  });

  it("draws a stable placeholder for a missing cover", () => {
    const { cards } = setup();
    const node = cards.cardNode(
      makeBook({ has_cover: false, title: "Солярис", author: "Лем", formats: ["epub", "pdf"] }),
    );
    const placeholder = node.querySelector<HTMLElement>(".placeholder");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.style.getPropertyValue("--ph-hue")).not.toBe("");
    expect(placeholder?.querySelector(".ph-title")?.textContent).toBe("Солярис");
    expect(placeholder?.querySelector(".ph-author")?.textContent).toBe("Лем");
    expect(placeholder?.querySelector(".ph-format")?.textContent).toBe("EPUB");
  });
});

describe("card body", () => {
  it("shows title, meta, formats and the edited badge", () => {
    const { cards } = setup();
    const node = cards.cardNode(
      makeBook({ formats: ["pdf", "djvu", "epub", "fb2", "rtf"], edited: true }),
    );

    expect(node.title).toBe("Анализ");
    expect(node.querySelector(".card-body > .title")?.textContent).toBe("Анализ");
    expect(node.querySelector(".card-body > .meta")?.textContent).toBe("Фихтенгольц · 1948");
    expect(node.querySelector(".edited")?.textContent).toBe("правлено");

    const formats = [...node.querySelectorAll(".formats i")].map((item) => item.textContent);
    expect(formats).toEqual(["pdf", "djvu", "epub", "fb2"]);
    expect(node.querySelector(".formats i")?.getAttribute("data-format")).toBe("pdf");
  });

  it("falls back to the size when author and year are missing", () => {
    const { cards } = setup();
    const node = cards.cardNode(makeBook({ author: null, year: null, size_mb: 5.94 }));
    expect(node.querySelector(".card-body > .meta")?.textContent).toBe("5.9 МБ");
  });

  it("shows at most three tags plus a counter", () => {
    const { cards } = setup();
    const tags = [
      makeBookTag({ id: 1, name: "a" }),
      makeBookTag({ id: 2, name: "b" }),
      makeBookTag({ id: 3, name: "c" }),
      makeBookTag({ id: 4, name: "d" }),
      makeBookTag({ id: 5, name: "e" }),
    ];
    const node = cards.cardNode(makeBook({ tags }));
    const chips = [...node.querySelectorAll(".tags .tag-chip")].map((chip) => chip.textContent);
    expect(chips).toEqual(["a", "b", "c"]);
    expect(node.querySelector(".tags .tag-more")?.textContent).toBe("+2");
  });

  it("filters by a card tag without opening the book", () => {
    const { cards, deps } = setup();
    const node = cards.cardNode(makeBook({ tags: [makeBookTag({ name: "Гегель" })] }));
    node.querySelector<HTMLButtonElement>(".tags .tag-chip")?.click();
    expect(deps.applyTagFilter).toHaveBeenCalledWith("Гегель");
    expect(deps.openBook).not.toHaveBeenCalled();
    expect(deps.openFiles).not.toHaveBeenCalled();
  });
});

describe("card primary action", () => {
  it("opens the host file manager for a host desktop client", () => {
    const { cards, deps } = setup({ hostDesktop: true });
    const book = makeBook();
    const node = cards.cardNode(book);
    expect(node.getAttribute("role")).toBe("button");
    expect(node.tabIndex).toBe(0);
    expect(node.getAttribute("aria-label")).toBe("Анализ — открыть в папке");

    node.click();
    expect(deps.openBook).toHaveBeenCalledWith(book);
    expect(deps.openFiles).not.toHaveBeenCalled();
  });

  it("shows downloadable formats for every other client", () => {
    const { cards, deps } = setup({ hostDesktop: false });
    const book = makeBook();
    const node = cards.cardNode(book);
    expect(node.getAttribute("aria-label")).toBe("Анализ — выбрать формат для скачивания");

    node.click();
    expect(deps.openFiles).toHaveBeenCalledWith(book);
    expect(deps.openBook).not.toHaveBeenCalled();
  });

  it.each(["Enter", " "])("activates the card with %j from the keyboard", (key) => {
    const { cards, deps } = setup({ hostDesktop: false });
    const book = makeBook();
    const node = cards.cardNode(book);
    node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(deps.openFiles).toHaveBeenCalledWith(book);
  });

  it("ignores other keys and events from nested controls", () => {
    const { cards, deps } = setup({ hostDesktop: true });
    const book = makeBook();
    const node = cards.cardNode(book);

    node.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    const info = node.querySelector<HTMLElement>(".icon-btn.info")!;
    info.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(deps.openBook).not.toHaveBeenCalled();
  });
});

describe("card actions", () => {
  it("opens details without triggering the card action", () => {
    const { cards, deps } = setup({ hostDesktop: true });
    const book = makeBook();
    const node = cards.cardNode(book);

    node.querySelector<HTMLElement>(".icon-btn.info")?.click();

    expect(deps.openDetails).toHaveBeenCalledWith(book);
    expect(deps.openBook).not.toHaveBeenCalled();
  });

  it("offers editing only to administrative clients", () => {
    const local = setup({ local: true });
    expect(local.cards.cardNode(makeBook()).querySelector(".icon-btn.edit")).not.toBeNull();

    const guest = setup({ local: false });
    expect(guest.cards.cardNode(makeBook()).querySelector(".icon-btn.edit")).toBeNull();
  });

  it("opens the editor without triggering the card action", () => {
    const { cards, deps } = setup({ local: true, hostDesktop: true });
    const book = makeBook();
    const node = cards.cardNode(book);
    node.querySelector<HTMLElement>(".icon-btn.edit")?.click();
    expect(deps.editBook).toHaveBeenCalledWith(book);
    expect(deps.openBook).not.toHaveBeenCalled();
  });
});

describe("list view", () => {
  it("renders one row per book with author, section and size cells", () => {
    const { cards } = setup();
    const node = cards.rowNode(makeBook({ section: "Математика", size_mb: 12.5 }));

    expect(node.className).toBe("row");
    expect(node.querySelector(".c-author")?.textContent).toBe("Фихтенгольц");
    expect(node.querySelector(".c-section")?.textContent).toBe("Математика");
    expect(node.querySelector(".c-size")?.textContent).toBe("12.5 МБ");
    expect(node.querySelector(".c-main .sub")?.textContent).toBe("Фихтенгольц");
    expect(node.querySelector(".edited")).toBeNull();
  });

  it("marks an edited row and fills missing cells with a dash", () => {
    const { cards } = setup();
    const node = cards.rowNode(makeBook({ author: null, section: null, edited: true }));
    expect(node.querySelector(".c-main .edited")?.textContent).toBe("правлено");
    expect(node.querySelector(".c-author")?.textContent).toBe("—");
    expect(node.querySelector(".c-section")?.textContent).toBe("—");
    expect(node.querySelector(".c-main .sub")).toBeNull();
  });

  it("sorts from the list head", () => {
    const { cards, deps } = setup({ sort: "title" });
    const head = cards.listHeadNode();
    const [title, size] = [...head.querySelectorAll("button")];
    expect(title?.textContent).toBe("Название");
    expect(size?.textContent).toBe("Размер");
    expect(title?.getAttribute("aria-pressed")).toBe("true");

    size?.click();
    expect(deps.sortBy).toHaveBeenCalledWith("size");
  });
});

describe("render helpers", () => {
  it("picks rows or cards from the current view", () => {
    const cards = setup({ view: "grid" });
    expect(cards.cards.renderBookNodes([makeBook()])[0]?.className).toBe("card");

    const rows = setup({ view: "list" });
    expect(rows.cards.renderBookNodes([makeBook()])[0]?.className).toBe("row");
  });

  it("builds skeleton placeholders", () => {
    const { cards } = setup();
    const skeletons = cards.skeletonNodes(3);
    expect(skeletons).toHaveLength(3);
    expect(skeletons[0]?.className).toBe("card skeleton");
    expect(skeletons[0]?.querySelector(".thumb")).not.toBeNull();
  });

  it("builds an empty state with an optional action button", () => {
    const { cards } = setup();
    const action = vi.fn();
    const withButton = cards.stateNode("Ничего не найдено", "Попробуйте", "Сбросить фильтры", action);
    expect(withButton.querySelector("h3")?.textContent).toBe("Ничего не найдено");
    withButton.querySelector("button")?.click();
    expect(action).toHaveBeenCalled();

    const withoutButton = cards.stateNode("Пусто", "Запустите скан", null, null);
    expect(withoutButton.querySelector("button")).toBeNull();
  });
});
