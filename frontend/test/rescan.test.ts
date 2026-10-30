import { describe, expect, it, vi } from "vitest";

import { findElements } from "../src/dom";
import { createRescan } from "../src/rescan";
import { createToast } from "../src/toast";
import { rescanResponse, stubBackend } from "./helpers/backend";
import { mountPage } from "./helpers/page";

function setup(routes: Parameters<typeof stubBackend>[0] = {}) {
  const doc = mountPage();
  const el = findElements(doc);
  const backend = stubBackend(routes);
  const refresh = {
    loadStatus: vi.fn(async () => {}),
    loadSections: vi.fn(async () => {}),
    loadFormats: vi.fn(async () => {}),
    loadBooks: vi.fn(async () => {}),
  };
  const rescan = createRescan({
    el,
    api: backend.api,
    toast: createToast(el, { after: () => 1, clear: () => {} }),
    ...refresh,
  });
  rescan.bind();
  return { doc, el, backend, refresh, rescan };
}

describe("rescan button", () => {
  it("reports the scan summary and refreshes every view", async () => {
    const { el, backend, refresh } = setup({
      "/api/rescan": rescanResponse({ added: 3, updated: 1, missing: 2, covers_built: 5, elapsed: 12.5 }),
    });

    el.rescan.click();

    await vi.waitFor(() =>
      expect(el.toast.textContent).toBe(
        "Добавлено 3, обновлено 1, пропало 2, обложек 5 (12.5 с)",
      ),
    );
    expect(backend.find("POST", "/api/rescan")?.headers).toMatchObject({ "X-Booklib": "1" });
    await vi.waitFor(() => {
      expect(refresh.loadStatus).toHaveBeenCalled();
      expect(refresh.loadSections).toHaveBeenCalled();
      expect(refresh.loadFormats).toHaveBeenCalled();
      expect(refresh.loadBooks).toHaveBeenCalled();
    });
  });

  it("shows progress and restores the button afterwards", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const { el } = setup({
      "/api/rescan": () => new Promise((resolve) => pending.push(resolve)),
    });

    el.rescan.click();

    expect(el.rescan.disabled).toBe(true);
    expect(el.rescan.querySelector(".label-wide")?.textContent).toBe("Сканирую…");

    pending[0]?.(rescanResponse());
    await vi.waitFor(() => expect(el.rescan.disabled).toBe(false));
    expect(el.rescan.querySelector(".label-wide")?.textContent).toBe("Обновить");
  });

  it("reports a failed scan and still restores the button", async () => {
    const { el } = setup({
      "/api/rescan": () => {
        throw new Error("диск отключён");
      },
    });

    el.rescan.click();

    await vi.waitFor(() => expect(el.toast.textContent).toBe("Скан не выполнен: диск отключён"));
    expect(el.rescan.disabled).toBe(false);
    expect(el.rescan.querySelector(".label-wide")?.textContent).toBe("Обновить");
  });
});
