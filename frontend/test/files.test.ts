import { describe, expect, it } from "vitest";

import { findElements } from "../src/dom";
import { createFiles } from "../src/files";
import { makeBook, makeFile } from "./helpers/books";
import { stubBackend } from "./helpers/backend";
import { mountPage } from "./helpers/page";

function setup(filesRoute?: unknown) {
  const doc = mountPage();
  const el = findElements(doc);
  const backend = stubBackend(filesRoute !== undefined ? { "/api/files": filesRoute } : {});
  const files = createFiles({ doc, el, api: backend.api });
  return { doc, el, backend, files };
}

describe("file link", () => {
  it("points at the download endpoint with encoded key and file", () => {
    const { files } = setup();
    const link = files.fileLinkNode(makeBook({ key: "math/Анализ" }), makeFile({ file: "math/Анализ.pdf" }));

    expect(link.tagName).toBe("A");
    expect(link.className).toBe("file-link");
    expect(link.getAttribute("href")).toBe(
      "/api/download?key=math%2F%D0%90%D0%BD%D0%B0%D0%BB%D0%B8%D0%B7&file=math%2F%D0%90%D0%BD%D0%B0%D0%BB%D0%B8%D0%B7.pdf",
    );
    expect(link.download).toBe("Анализ.pdf");
    expect(link.querySelector(".fmt")?.textContent).toBe("pdf");
    expect(link.querySelector(".f-name")?.textContent).toBe("Анализ.pdf");
    expect(link.querySelector(".f-meta")?.textContent).toBe("12.5 МБ");
    expect(link.querySelector("svg use")?.getAttribute("href")).toBe("#i-download");
  });

  it("shows kilobytes for a tiny file", () => {
    const { files } = setup();
    const link = files.fileLinkNode(makeBook(), makeFile({ size_mb: 0.4 }));
    expect(link.querySelector(".f-meta")?.textContent).toBe("410 КБ");
  });
});

describe("files dialog", () => {
  it("opens the dialog with its own title and a loading placeholder", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const { el, files } = setup(() => new Promise((resolve) => pending.push(resolve)));

    const request = files.openFiles(makeBook({ title: "Анализ" }));

    expect(el.files.open).toBe(true);
    expect(el.filesTitle.textContent).toBe("Анализ");
    expect(el.filesList.textContent).toBe("загружаю…");

    pending[0]?.([makeFile()]);
    await request;
  });

  it("lists every format as a download link without the own-page header", async () => {
    const { el, backend, files } = setup([
      makeFile(),
      makeFile({ file: "math/Анализ.djvu", name: "Анализ.djvu", format: "djvu", size_mb: 300 }),
    ]);

    await files.openFiles(makeBook());

    const links = [...el.filesList.querySelectorAll("a")];
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.download)).toEqual(["Анализ.pdf", "Анализ.djvu"]);
    expect(backend.find("GET", "/api/files")?.headers).not.toHaveProperty("X-Booklib");
    expect(backend.find("GET", "/api/files")?.path).toBe("/api/files?key=math%2F%D0%90%D0%BD%D0%B0%D0%BB%D0%B8%D0%B7");
  });

  it("falls back to the key when the card has no title", async () => {
    const { el, files } = setup([]);
    await files.openFiles(makeBook({ title: "" }));
    expect(el.filesTitle.textContent).toBe("math/Анализ");
    expect(el.filesList.textContent).toBe("файлов нет");
  });

  it("reports a failed file list inside the dialog", async () => {
    const { el, files } = setup(() => {
      throw new Error("карточка пропала");
    });
    await files.openFiles(makeBook());
    expect(el.filesList.textContent).toBe("не удалось загрузить: карточка пропала");
  });

  it("replaces a previous list instead of appending to it", async () => {
    const { el, files } = setup([makeFile()]);
    await files.openFiles(makeBook());
    await files.openFiles(makeBook({ key: "math/Другая" }));
    expect(el.filesList.querySelectorAll("a")).toHaveLength(1);
  });
});
