import { describe, expect, it, vi } from "vitest";

import { findElements } from "../src/dom";
import { createSettings } from "../src/settings";
import { createToast } from "../src/toast";
import { previewResponse, rescanResponse, settingsResponse, stubBackend } from "./helpers/backend";
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
  const closeNavOnMobile = vi.fn();
  const settings = createSettings({
    doc,
    el,
    api: backend.api,
    toast: createToast(el, { after: () => 1, clear: () => {} }),
    closeNavOnMobile,
    ...refresh,
  });
  settings.bind();
  return { doc, el, backend, settings, refresh, closeNavOnMobile };
}

function submitRoot(el: ReturnType<typeof findElements>, root: string): Event {
  el.sRoot.value = root;
  const event = new Event("submit", { bubbles: true, cancelable: true });
  el.sForm.dispatchEvent(event);
  return event;
}

describe("settings dialog", () => {
  it("shows the active root with its source and the cover pipeline", async () => {
    const { el, settings, closeNavOnMobile } = setup();

    await settings.openSettings();

    expect(el.settings.open).toBe(true);
    expect(closeNavOnMobile).toHaveBeenCalled();
    expect(el.sCurrent.textContent).toBe("сейчас: /mnt/books (рантайм-конфиг)");
    expect(el.sRoot.value).toBe("/mnt/books");
    expect(el.sRoot.disabled).toBe(false);
    expect(el.sInfo.textContent).toBe("обложки: 400×600, требуемые утилиты на месте");
    expect(el.sApply.disabled).toBe(true);
  });

  it("names the env sources and missing tools", async () => {
    const { el, settings } = setup({
      "/api/settings": settingsResponse({
        root_source: "env-file",
        read_only: {
          ...settingsResponse().read_only,
          tools: { pdftocairo: true, djvused: false },
        },
      }),
    });
    await settings.openSettings();

    expect(el.sCurrent.textContent).toContain("(файл .env)");
    expect(el.sInfo.textContent).toBe("не найдены: djvused — обложки могут не генерироваться");
  });

  it("keeps the path field usable when the settings request fails", async () => {
    const { el, settings } = setup({
      "/api/settings": () => {
        throw new Error("нет доступа");
      },
    });

    await settings.openSettings();

    expect(el.settings.open).toBe(true);
    expect(el.sRoot.disabled).toBe(false);
    expect(el.sPreview.textContent).toBe("Не удалось загрузить настройки: нет доступа");
    expect(el.sPreview.className).toBe("error");
    expect(el.sPreview.hidden).toBe(false);
  });
});

describe("root preview", () => {
  it("refuses an empty path without asking the server", async () => {
    const { el, backend } = setup();
    const event = submitRoot(el, "   ");

    expect(event.defaultPrevented).toBe(true);
    expect(el.sPreview.textContent).toBe("Укажите путь к папке библиотеки");
    expect(el.sPreview.className).toBe("warn");
    expect(el.sApply.disabled).toBe(true);
    expect(backend.count("GET", "/api/settings/preview")).toBe(0);
  });

  it("previews a valid root and enables applying it", async () => {
    const { el, backend } = setup();
    submitRoot(el, "/mnt/new books");

    await vi.waitFor(() => expect(backend.count("GET", "/api/settings/preview")).toBe(1));
    const call = backend.find("GET", "/api/settings/preview");
    expect(call?.path).toBe("/api/settings/preview?root=%2Fmnt%2Fnew%20books");
    expect(call?.headers).toMatchObject({ "X-Booklib": "1" });

    await vi.waitFor(() =>
      expect(el.sPreview.textContent).toBe("12 файлов: 10 книжных, 2 аудио"),
    );
    expect(el.sPreview.className).toBe("");
    expect(el.sApply.disabled).toBe(false);
    expect(el.sCheck.disabled).toBe(false);
  });

  it("warns when the walk was truncated by the budget", async () => {
    const { el } = setup({
      "/api/settings/preview": previewResponse({ files: 20000, books: 19990, audio: 10, truncated: true }),
    });
    submitRoot(el, "/mnt/huge");

    await vi.waitFor(() => expect(el.sPreview.className).toBe("warn"));
    expect(el.sPreview.textContent).toContain("обход прерван по бюджету");
    expect(el.sApply.disabled).toBe(false);
  });

  it("warns about a folder without books but still allows applying it", async () => {
    const { el } = setup({
      "/api/settings/preview": previewResponse({ files: 0, books: 0, audio: 0 }),
    });
    submitRoot(el, "/mnt/empty");

    await vi.waitFor(() =>
      expect(el.sPreview.textContent).toContain("в этой папке нет книжных файлов"),
    );
    expect(el.sPreview.className).toBe("warn");
    expect(el.sApply.disabled).toBe(false);
  });

  it("shows a rejected path as an error", async () => {
    const { el } = setup({
      "/api/settings/preview": () => {
        throw new Error("это не каталог: /mnt/file");
      },
    });
    submitRoot(el, "/mnt/file");

    await vi.waitFor(() => expect(el.sPreview.className).toBe("error"));
    expect(el.sPreview.textContent).toBe("это не каталог: /mnt/file");
    expect(el.sApply.disabled).toBe(true);
    expect(el.sCheck.disabled).toBe(false);
  });

  it("invalidates the preview when the path changes afterwards", async () => {
    const { el } = setup();
    submitRoot(el, "/mnt/new");
    await vi.waitFor(() => expect(el.sApply.disabled).toBe(false));

    el.sRoot.value = "/mnt/other";
    el.sRoot.dispatchEvent(new Event("input"));

    expect(el.sApply.disabled).toBe(true);
    expect(el.sPreview.hidden).toBe(true);
  });
});

describe("applying the root", () => {
  it("posts the new root, closes the dialog and refreshes the view", async () => {
    const { el, backend, refresh } = setup({
      "/api/settings": rescanResponse({ added: 4, covers_built: 2, elapsed: 3.25 }),
    });
    el.settings.showModal();
    submitRoot(el, "/mnt/new");
    await vi.waitFor(() => expect(el.sApply.disabled).toBe(false));

    el.sApply.click();

    await vi.waitFor(() => expect(backend.count("POST", "/api/settings")).toBe(1));
    expect(backend.find("POST", "/api/settings")?.body).toEqual({ root: "/mnt/new" });
    await vi.waitFor(() => expect(el.settings.open).toBe(false));
    await vi.waitFor(() =>
      expect(el.toast.textContent).toBe("Корень сменён: добавлено 4, обложек 2 (3.25 с)"),
    );
    await vi.waitFor(() => {
      expect(refresh.loadStatus).toHaveBeenCalled();
      expect(refresh.loadSections).toHaveBeenCalled();
      expect(refresh.loadFormats).toHaveBeenCalled();
      expect(refresh.loadBooks).toHaveBeenCalled();
    });
  });

  it("keeps the dialog open and the error next to the field on failure", async () => {
    const { el, refresh } = setup({
      "/api/settings": () => {
        throw new Error("путь не существует: /mnt/new");
      },
    });
    el.settings.showModal();
    submitRoot(el, "/mnt/new");
    await vi.waitFor(() => expect(el.sApply.disabled).toBe(false));

    el.sApply.click();

    await vi.waitFor(() => expect(el.sPreview.className).toBe("error"));
    expect(el.settings.open).toBe(true);
    expect(el.sPreview.textContent).toBe("путь не существует: /mnt/new");
    expect(el.sApply.disabled).toBe(true);
    expect(el.sCheck.disabled).toBe(false);
    expect(refresh.loadBooks).not.toHaveBeenCalled();
  });

  it("cancels without touching the server", () => {
    const { el, backend } = setup();
    el.settingsBtn.click();
    el.sCancel.click();
    expect(el.settings.open).toBe(false);
    expect(backend.count("POST", "/api/settings")).toBe(0);
  });
});

it('keeps the native settings form out of dialog submission mode', () => {
  const doc = mountPage();
  const form = doc.querySelector<HTMLFormElement>('#s-form');
  expect(form).not.toBeNull();
  expect(form?.method).not.toBe('dialog');
});
