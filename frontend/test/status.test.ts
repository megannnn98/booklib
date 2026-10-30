import { describe, expect, it } from "vitest";

import { createState } from "../src/catalog_state";
import { findElements } from "../src/dom";
import { createStatus } from "../src/status";
import { statusResponse, stubBackend } from "./helpers/backend";
import { mountPage } from "./helpers/page";

function setup(status: Parameters<typeof statusResponse>[0] | (() => never)) {
  const doc = mountPage();
  const el = findElements(doc);
  const state = createState(null);
  const backend = stubBackend({
    "/api/status": typeof status === "function" ? status : statusResponse(status),
  });
  const statusView = createStatus({ doc, el, state, api: backend.api });
  return { doc, el, state, backend, statusView };
}

describe("status line", () => {
  it("marks a local host desktop client and shows the covers counter", async () => {
    const { doc, el, state, statusView } = setup({
      local: true,
      host_desktop: true,
      mounted: true,
      covers: 2982,
    });

    await statusView.loadStatus();

    expect(state.local).toBe(true);
    expect(state.hostDesktop).toBe(true);
    expect(doc.body.classList.contains("remote")).toBe(false);
    expect(el.status.textContent).toContain("2982 обложек · скан ");
    expect(el.status.textContent).not.toContain("—");
    expect(el.banner.hidden).toBe(true);
  });

  it("marks a network client as remote and never as host desktop", async () => {
    const { doc, el, state, statusView } = setup({
      local: false,
      host_desktop: false,
      mounted: true,
      covers: 0,
    });

    await statusView.loadStatus();

    expect(state.local).toBe(false);
    expect(state.hostDesktop).toBe(false);
    expect(doc.body.classList.contains("remote")).toBe(true);
    expect(el.status.textContent).toBe(`0 обложек · скан ${new Date(1700000000 * 1000).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}`);
  });

  it("warns that the library is not mounted", async () => {
    const { el, statusView } = setup({ mounted: false, covers: 12 });

    await statusView.loadStatus();

    expect(el.status.querySelector(".warn")?.textContent).toBe("библиотека не смонтирована");
    expect(el.banner.hidden).toBe(false);
    expect(el.banner.textContent).toBe(
      "Библиотека не смонтирована: каталог показан из кэша, " +
        "скачивание и открытие файлов недоступны.",
    );
  });

  it("treats a missing role flag as local and a missing last_scan as a dash", async () => {
    const doc = mountPage();
    const el = findElements(doc);
    const state = createState(null);
    const backend = stubBackend({
      "/api/status": () => ({
        mounted: true,
        covers: 1,
        total: 0,
        missing: 0,
        last_scan: null,
      }),
    });
    const statusView = createStatus({ doc, el, state, api: backend.api });

    await statusView.loadStatus();

    expect(state.local).toBe(true);
    expect(state.hostDesktop).toBe(false);
    expect(el.status.textContent).toBe("1 обложек · скан —");
  });

  it("propagates a status failure so the caller can fail closed", async () => {
    const { el, statusView } = setup(() => {
      throw new Error("сервис недоступен");
    });
    await expect(statusView.loadStatus()).rejects.toThrow("сервис недоступен");
    expect(el.status.textContent).toBe("");
  });
});
