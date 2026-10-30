"use strict";

// Чистые функции витрины без DOM: их гоняет node --test (tests/unit/test_ui_helpers.cjs).
(function initUiHelpers(globalObject) {
  // Порядок параметров фиксирован: тест сравнивает строку целиком, а браузеру
  // одинаковый URL для одного и того же состояния даёт попадание в HTTP-кэш.
  function buildBooksQuery(filters, offset, limit) {
    const params = new URLSearchParams({ section: filters.section, sort: filters.sort });
    if (filters.q) params.set("q", filters.q);
    for (const tag of filters.tags) params.append("tag", tag);
    for (const format of filters.formats) params.append("format", format);
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    // URLSearchParams кодирует «*» как %2A — сервер понимает оба, читать проще так.
    return params.toString().replace("section=%2A", "section=*");
  }

  function activeFilters(filters) {
    const chips = [];
    if (filters.section && filters.section !== "*") {
      chips.push({ kind: "section", value: filters.section, label: filters.section });
    }
    if (filters.q) {
      chips.push({ kind: "q", value: filters.q, label: `«${filters.q}»` });
    }
    for (const tag of filters.tags) {
      chips.push({ kind: "tag", value: tag, label: `#${tag}` });
    }
    for (const format of filters.formats) {
      chips.push({ kind: "format", value: format, label: format.toUpperCase() });
    }
    return chips;
  }

  function filterSections(sections, term) {
    const needle = term.trim().toLowerCase();
    if (!needle) return sections;
    return sections.filter((item) => item.name.toLowerCase().includes(needle));
  }

  // localStorage может бросать (приватный режим, запрет cookies) — настройки
  // вида тогда просто не запоминаются, витрина работает с умолчаниями.
  function readPref(storage, key, allowed, fallback) {
    try {
      const value = storage ? storage.getItem(key) : null;
      return allowed.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function writePref(storage, key, value) {
    try {
      if (storage) storage.setItem(key, value);
    } catch { /* не запомнили — не страшно */ }
  }

  // Оттенок заглушки обложки: стабилен для названия, чтобы витрина не «мигала»
  // цветами между перезагрузками.
  function placeholderHue(text) {
    let hash = 0;
    for (const char of String(text || "")) {
      hash = (hash * 31 + char.codePointAt(0)) % 360;
    }
    return hash;
  }

  const api = {
    buildBooksQuery,
    activeFilters,
    filterSections,
    readPref,
    writePref,
    placeholderHue,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalObject.BooklibUiHelpers = api;
})(globalThis);
