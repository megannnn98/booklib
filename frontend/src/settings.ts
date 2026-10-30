// Настройки: активный корень, предпросмотр нового и его применение.
//
// Форма объявлена БЕЗ method="dialog": submit (в том числе Enter в поле пути)
// — это «Проверить», а кнопки действий — обычные button с обработчиками.

import type { ApiClient } from "./api";
import { plural } from "./catalog_state";
import type { Elements } from "./dom";
import type { Toast } from "./toast";
import type { RescanResult, RootPreviewResponse, SettingsResponse } from "./types";

const SOURCE_NAMES: Record<string, string> = {
  config: "рантайм-конфиг",
  env: "окружение",
  "env-file": "файл .env",
  default: "по умолчанию",
};

export interface SettingsDeps {
  doc: Document;
  el: Elements;
  api: ApiClient;
  toast: Toast;
  closeNavOnMobile(): void;
  loadStatus(): Promise<void>;
  loadSections(): Promise<void>;
  loadFormats(): Promise<void>;
  loadBooks(): Promise<void>;
}

export interface SettingsDialog {
  bind(): void;
  openSettings(): Promise<void>;
  checkRoot(): Promise<void>;
  applySettings(): Promise<void>;
}

export function createSettings(deps: SettingsDeps): SettingsDialog {
  const { el } = deps;

  function setPreview(message: string, kind = ""): void {
    el.sPreview.textContent = message;
    el.sPreview.className = kind;
    el.sPreview.hidden = !message;
  }

  async function checkRoot(): Promise<void> {
    const value = el.sRoot.value.trim();
    setPreview("");
    el.sApply.disabled = true;
    if (!value) {
      setPreview("Укажите путь к папке библиотеки", "warn");
      return;
    }

    el.sCheck.disabled = true;
    try {
      const data = await deps.api.get<RootPreviewResponse>(
        `/api/settings/preview?root=${encodeURIComponent(value)}`,
      );
      let message =
        `${data.files} ${plural(data.files, "файл", "файла", "файлов")}` +
        `: ${data.books} ${plural(data.books, "книжный", "книжных", "книжных")}`;
      if (data.audio) {
        message += `, ${data.audio} аудио`;
      }
      let kind = "";
      if (data.truncated) {
        message += " — обход прерван по бюджету, числа приблизительные";
        kind = "warn";
      } else if (data.books + data.audio === 0) {
        message += " — в этой папке нет книжных файлов, каталог станет пустым";
        kind = "warn";
      }
      setPreview(message, kind);
      el.sApply.disabled = false;
    } catch (error) {
      setPreview((error as Error).message, "error");
    } finally {
      el.sCheck.disabled = false;
    }
  }

  async function openSettings(): Promise<void> {
    deps.closeNavOnMobile();
    el.sApply.disabled = true;
    el.sRoot.disabled = true;
    el.sCurrent.textContent = "";
    el.sInfo.textContent = "";
    setPreview("");
    el.settings.showModal();

    try {
      const data = await deps.api.get<SettingsResponse>("/api/settings");
      const source = SOURCE_NAMES[data.root_source] ?? data.root_source;
      el.sCurrent.textContent = `сейчас: ${data.root} (${source})`;
      el.sRoot.value = data.root;
      el.sRoot.disabled = false;
      const missing = Object.entries(data.read_only.tools)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);
      el.sInfo.textContent = missing.length
        ? `не найдены: ${missing.join(", ")} — обложки могут не генерироваться`
        : `обложки: ${data.read_only.cover_width}×${data.read_only.cover_max_height}, ` +
          "требуемые утилиты на месте";
    } catch (error) {
      // Поле снова доступно: настройки не загрузились, но путь ввести и проверить
      // всё ещё можно — иначе диалог остаётся мёртвым до закрытия и открытия.
      el.sRoot.disabled = false;
      setPreview(`Не удалось загрузить настройки: ${(error as Error).message}`, "error");
    }
  }

  async function applySettings(): Promise<void> {
    el.sApply.disabled = true;
    el.sCheck.disabled = true;
    setPreview("Применяю…");
    try {
      const result = await deps.api.send<RescanResult>("/api/settings", "POST", {
        root: el.sRoot.value.trim(),
      });
      el.settings.close();
      deps.toast.show(
        `Корень сменён: добавлено ${result.added}, обложек ${result.covers_built}` +
          ` (${result.elapsed} с)`,
      );
      await Promise.all([
        deps.loadStatus(),
        deps.loadSections(),
        deps.loadFormats(),
        deps.loadBooks(),
      ]);
    } catch (error) {
      // Диалог остаётся открытым: путь уже введён, и ошибку надо показать рядом с
      // полем, а не тостом поверх витрины, которая ничего не меняла. «Применить»
      // остаётся заблокированной до повторной проверки.
      setPreview((error as Error).message, "error");
    } finally {
      el.sCheck.disabled = false;
    }
  }

  function bind(): void {
    el.settingsBtn.addEventListener("click", () => {
      void openSettings();
    });
    // Единственный путь к проверке пути: и клик по «Проверить», и Enter в поле —
    // это submit формы. preventDefault оставляет диалог открытым.
    el.sForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void checkRoot();
    });
    el.sCancel.addEventListener("click", () => el.settings.close());
    el.sApply.addEventListener("click", () => {
      void applySettings();
    });
    // Путь изменили после проверки — предпросмотр больше не про него, и применять
    // непроверенное значение нельзя.
    el.sRoot.addEventListener("input", () => {
      el.sApply.disabled = true;
      setPreview("");
    });
  }

  return { bind, openSettings, checkRoot, applySettings };
}
