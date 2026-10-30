// Лист файлов карточки: удалённый клиент нажимает на карточку и получает
// ссылки на скачивание каждого формата. Ручки /api/files и /api/download
// публичные, поэтому ссылку можно открыть и без собственной страницы.

import type { ApiClient } from "./api";
import { bytesLabel } from "./catalog_state";
import { make, svgIcon, type Elements } from "./dom";
import type { BookDto, FileEntryDto } from "./types";

export interface FilesDeps {
  doc: Document;
  el: Elements;
  api: ApiClient;
}

export interface FilesDialog {
  openFiles(book: BookDto): Promise<void>;
  fillFiles(container: HTMLElement, book: BookDto): Promise<void>;
  fileLinkNode(book: BookDto, item: FileEntryDto): HTMLAnchorElement;
}

export function createFiles(deps: FilesDeps): FilesDialog {
  const { doc, el } = deps;

  function fileLinkNode(book: BookDto, item: FileEntryDto): HTMLAnchorElement {
    const link = doc.createElement("a");
    link.className = "file-link";
    link.href =
      `/api/download?key=${encodeURIComponent(book.key)}` +
      `&file=${encodeURIComponent(item.file)}`;
    link.download = item.name;
    link.append(
      make(doc, "span", "fmt", item.format),
      make(doc, "span", "f-name", item.name),
      make(doc, "span", "f-meta", bytesLabel(item.size_mb ?? 0)),
      svgIcon(doc, "download"),
    );
    return link;
  }

  async function fillFiles(container: HTMLElement, book: BookDto): Promise<void> {
    container.replaceChildren(make(doc, "div", "f-meta", "загружаю…"));
    try {
      const items = await deps.api.get<FileEntryDto[]>(
        `/api/files?key=${encodeURIComponent(book.key)}`,
      );
      container.replaceChildren(
        ...(items.length
          ? items.map((item) => fileLinkNode(book, item))
          : [make(doc, "div", "f-meta", "файлов нет")]),
      );
    } catch (error) {
      container.replaceChildren(
        make(doc, "div", "f-meta", `не удалось загрузить: ${(error as Error).message}`),
      );
    }
  }

  function openFiles(book: BookDto): Promise<void> {
    el.filesTitle.textContent = book.title || book.key;
    el.files.showModal();
    return fillFiles(el.filesList, book);
  }

  return { openFiles, fillFiles, fileLinkNode };
}
