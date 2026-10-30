import { describe, expect, it, vi } from "vitest";

import { createState } from "../src/catalog_state";
import { findElements } from "../src/dom";
import { createTagsAdmin } from "../src/tags_admin";
import { createToast } from "../src/toast";
import { makeTag } from "./helpers/books";
import { stubBackend } from "./helpers/backend";
import { mountPage } from "./helpers/page";

function setup(
  availableTags = [makeTag(), makeTag({ id: 2, name: "Гегель", count: 5 })],
  routes: Parameters<typeof stubBackend>[0] = {},
) {
  const doc = mountPage();
  const el = findElements(doc);
  const state = createState(null, { availableTags });
  const backend = stubBackend({ "/api/tags": availableTags, ...routes });
  const loadTags = vi.fn(async () => {});
  const closeNavOnMobile = vi.fn();
  const admin = createTagsAdmin({
    doc,
    el,
    state,
    api: backend.api,
    toast: createToast(el, { after: () => 1, clear: () => {} }),
    loadTags,
    closeNavOnMobile,
  });
  return { doc, el, state, backend, admin, loadTags, closeNavOnMobile };
}

describe("tag dictionary list", () => {
  it("renders name, kind and usage count", () => {
    const { el, admin } = setup();
    admin.renderAdminList();
    const rows = [...el.taList.querySelectorAll("button")];
    expect(rows.map((row) => row.textContent)).toEqual(["Платон · person · 0", "Гегель · person · 5"]);
    expect(rows[0]?.className).toBe("admin-row");
  });

  it("filters by name, kind and alias", () => {
    const { el, admin } = setup([
      makeTag({ id: 1, name: "Платон", kind: "person", aliases: ["платонизм"] }),
      makeTag({ id: 2, name: "pdf", kind: "form", aliases: ["формат"] }),
    ]);
    admin.renderAdminList();

    el.taSearch.value = "form";
    admin.renderAdminList();
    expect(el.taList.querySelectorAll("button")).toHaveLength(1);

    el.taSearch.value = "ПЛАТОНИЗМ";
    admin.renderAdminList();
    expect(el.taList.querySelector("button")?.textContent).toContain("Платон");
  });

  it("selects a tag and fills the form", () => {
    const { el, state, admin } = setup([
      makeTag({ id: 7, name: "Платон", kind: "person", description: "философ" }),
    ]);
    admin.renderAdminList();

    el.taList.querySelector<HTMLElement>("button")?.click();

    expect(state.selectedTagId).toBe(7);
    expect(el.taName.value).toBe("Платон");
    expect(el.taKind.value).toBe("person");
    expect(el.taDescription.value).toBe("философ");
    expect(el.taAlias.value).toBe("");
    expect(el.taMergeTarget.value).toBe("");
    expect(el.taList.querySelector("button")?.classList.contains("selected")).toBe(true);
  });
});

describe("tag dictionary actions", () => {
  it("opens the dialog with a clean search", () => {
    const { el, admin, closeNavOnMobile } = setup();
    admin.bind();
    el.taSearch.value = "старое";
    el.tagsAdminBtn.click();
    expect(el.tagsadmin.open).toBe(true);
    expect(el.taSearch.value).toBe("");
    expect(closeNavOnMobile).toHaveBeenCalled();
    expect(el.taList.querySelectorAll(".admin-row").length).toBeGreaterThan(0);
  });

  it("creates a tag and reloads the dictionary", async () => {
    const { el, backend, admin, loadTags } = setup();
    admin.bind();
    el.taName.value = "Аристотель";
    el.taKind.value = "person";
    el.taDescription.value = "ученик Платона";

    el.taCreate.click();

    await vi.waitFor(() => expect(backend.count("POST", "/api/tags")).toBe(1));
    expect(backend.find("POST", "/api/tags")?.body).toEqual({
      name: "Аристотель",
      kind: "person",
      description: "ученик Платона",
    });
    await vi.waitFor(() => expect(loadTags).toHaveBeenCalled());
  });

  it("falls back to the custom kind for a new tag", async () => {
    const { el, backend, admin } = setup();
    admin.bind();
    el.taName.value = "Новое";
    el.taKind.value = "";

    el.taCreate.click();

    await vi.waitFor(() => expect(backend.count("POST", "/api/tags")).toBe(1));
    expect(backend.find("POST", "/api/tags")?.body).toMatchObject({ kind: "custom" });
  });

  it("saves edits for the selected tag", async () => {
    const { el, state, backend, admin } = setup();
    admin.bind();
    state.selectedTagId = 7;
    el.taName.value = "Платон";
    el.taKind.value = "person";
    el.taDescription.value = "";

    el.taSave.click();

    await vi.waitFor(() => expect(backend.count("PUT", "/api/tags/7")).toBe(1));
    expect(backend.find("PUT", "/api/tags/7")?.body).toEqual({
      name: "Платон",
      kind: "person",
      description: "",
    });
  });

  it("does nothing without a selected tag", async () => {
    const { el, backend, admin } = setup();
    admin.bind();
    el.taSave.click();
    el.taAddAlias.click();
    el.taRemoveAlias.click();
    el.taMerge.click();
    el.taDelete.click();
    await Promise.resolve();
    expect(backend.calls.filter((call) => call.method !== "GET")).toHaveLength(0);
  });

  it("adds and removes an alias", async () => {
    const { el, state, backend, admin } = setup();
    admin.bind();
    state.selectedTagId = 3;
    el.taAlias.value = "платонизм";

    el.taAddAlias.click();
    await vi.waitFor(() => expect(backend.count("POST", "/api/tags/3/aliases")).toBe(1));
    expect(backend.find("POST", "/api/tags/3/aliases")?.body).toEqual({ alias: "платонизм" });

    el.taRemoveAlias.click();
    await vi.waitFor(() => expect(backend.count("DELETE", "/api/tags/3/aliases")).toBe(1));
    expect(backend.find("DELETE", "/api/tags/3/aliases")?.path).toBe(
      "/api/tags/3/aliases?alias=%D0%BF%D0%BB%D0%B0%D1%82%D0%BE%D0%BD%D0%B8%D0%B7%D0%BC",
    );
  });

  it("merges into a tag resolved by name", async () => {
    const { el, state, backend, admin } = setup();
    admin.bind();
    state.selectedTagId = 3;
    el.taMergeTarget.value = "Гегель";

    el.taMerge.click();

    await vi.waitFor(() => expect(backend.count("POST", "/api/tags/merge")).toBe(1));
    expect(backend.find("POST", "/api/tags/merge")?.body).toEqual({ source: 3, target: 2 });
  });

  it("ignores a merge target that is not in the dictionary", async () => {
    const { el, state, backend, admin } = setup();
    admin.bind();
    state.selectedTagId = 3;
    el.taMergeTarget.value = "Неизвестный";
    el.taMerge.click();
    await Promise.resolve();
    expect(backend.count("POST", "/api/tags/merge")).toBe(0);
  });

  it("deletes the selected tag and clears the selection", async () => {
    const { el, state, backend, admin } = setup(undefined, { "/api/tags/5": {} });
    admin.bind();
    state.selectedTagId = 5;

    el.taDelete.click();

    await vi.waitFor(() => expect(backend.count("DELETE", "/api/tags/5")).toBe(1));
    await vi.waitFor(() => expect(state.selectedTagId).toBeNull());
  });

  it("reports a rejected action and keeps the selection", async () => {
    const doc = mountPage();
    const el = findElements(doc);
    const state = createState(null, { selectedTagId: 9 });
    const backend = stubBackend({
      "/api/tags/9": () => {
        throw new Error("тег используется");
      },
    });
    const admin = createTagsAdmin({
      doc,
      el,
      state,
      api: backend.api,
      toast: createToast(el, { after: () => 1, clear: () => {} }),
      loadTags: vi.fn(async () => {}),
      closeNavOnMobile: vi.fn(),
    });
    admin.bind();

    el.taDelete.click();

    await vi.waitFor(() =>
      expect(el.toast.textContent).toBe("Не сохранилось: тег используется"),
    );
    expect(state.selectedTagId).toBe(9);
  });
});
