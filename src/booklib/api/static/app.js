"use strict";

const state = {
  section: "*",
  q: "",
  sort: "title",
  sections: [],
  local: true,
  tags: [],
  availableTags: [],
  editorTags: [],
  selectedTagId: null,
};

const el = {
  sections: document.getElementById("sections"),
  status: document.getElementById("status"),
  grid: document.getElementById("grid"),
  counter: document.getElementById("counter"),
  search: document.getElementById("search"),
  sort: document.getElementById("sort"),
  rescan: document.getElementById("rescan"),
  settingsBtn: document.getElementById("settingsBtn"),
  tagsBtn: document.getElementById("tagsBtn"),
  tagsAdminBtn: document.getElementById("tagsAdminBtn"),
  burger: document.getElementById("burger"),
  tagbar: document.getElementById("tagbar"),
  tagfilter: document.getElementById("tagfilter"),
  tfSearch: document.getElementById("tf-search"),
  tfList: document.getElementById("tf-list"),
  tfClear: document.getElementById("tf-clear"),
  tfClose: document.getElementById("tf-close"),
  tagsadmin: document.getElementById("tagsadmin"),
  taSearch: document.getElementById("ta-search"),
  taList: document.getElementById("ta-list"),
  taName: document.getElementById("ta-name"),
  taKind: document.getElementById("ta-kind"),
  taDescription: document.getElementById("ta-description"),
  taAlias: document.getElementById("ta-alias"),
  taMergeTarget: document.getElementById("ta-merge-target"),
  taCreate: document.getElementById("ta-create"),
  taSave: document.getElementById("ta-save"),
  taAddAlias: document.getElementById("ta-add-alias"),
  taRemoveAlias: document.getElementById("ta-remove-alias"),
  taMerge: document.getElementById("ta-merge"),
  taDelete: document.getElementById("ta-delete"),
  taClose: document.getElementById("ta-close"),
  settings: document.getElementById("settings"),
  sCurrent: document.getElementById("s-current"),
  sForm: document.getElementById("s-form"),
  sRoot: document.getElementById("s-root"),
  sCheck: document.getElementById("s-check"),
  sCancel: document.getElementById("s-cancel"),
  sPreview: document.getElementById("s-preview"),
  sInfo: document.getElementById("s-info"),
  sApply: document.getElementById("s-apply"),
  files: document.getElementById("files"),
  filesTitle: document.getElementById("files-title"),
  filesList: document.getElementById("files-list"),
  filesCancel: document.getElementById("files-cancel"),
  toast: document.getElementById("toast"),
  editor: document.getElementById("editor"),
  eKey: document.getElementById("e-key"),
  eTitle: document.getElementById("e-title"),
  eAuthor: document.getElementById("e-author"),
  eSection: document.getElementById("e-section"),
  eTags: document.getElementById("e-tags"),
  eTagInput: document.getElementById("e-tag-input"),
  eTagAdd: document.getElementById("e-tag-add"),
  tagsList: document.getElementById("tags-list"),
  sectionsList: document.getElementById("sections-list"),
};

let toastTimer = null;

function toast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle("error", isError);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "X-Booklib": "1", ...(options.headers || {}) },
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      detail = body.error || body.detail || detail;
      if (body.count !== undefined) {
        detail = `${detail} (${body.count})`;
      }
    } catch { /* тело не json — оставляем код */ }
    throw new Error(detail);
  }
  return response.json();
}

function postJson(path, payload) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function normalizeTagName(value) {
  return value.trim();
}

function currentTagNames() {
  return state.editorTags.map((tag) => tag.name);
}

function renderTagChips(container, items, onRemove, onClick) {
  container.replaceChildren(...items.map((item) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip";
    chip.textContent = item.name;
    if (item.kind) {
      chip.dataset.kind = item.kind;
    }
    if (onClick) {
      chip.onclick = (event) => {
        event.stopPropagation();
        onClick(item);
      };
    }
    if (onRemove) {
      const remove = document.createElement("span");
      remove.className = "tag-x";
      remove.textContent = "✕";
      remove.onclick = (event) => {
        event.stopPropagation();
        onRemove(item);
      };
      chip.append(remove);
    }
    return chip;
  }));
}

function renderTagBar() {
  const selected = state.availableTags.filter((tag) => state.tags.includes(tag.name));
  el.tagbar.hidden = selected.length === 0;
  if (!selected.length) {
    el.tagsBtn.textContent = "🏷 теги 0";
    el.tagbar.textContent = "";
    return;
  }
  el.tagsBtn.textContent = `🏷 теги ${selected.length}`;
  const chips = selected.map((tag) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip";
    chip.textContent = tag.name;
    chip.onclick = () => {
      state.tags = state.tags.filter((name) => name !== tag.name);
      renderTagBar();
      loadBooks();
    };
    return chip;
  });
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "tag-reset";
  reset.textContent = "сбросить";
  reset.onclick = () => {
    state.tags = [];
    renderTagBar();
    loadBooks();
  };
  el.tagbar.replaceChildren(...chips, reset);
}

function renderFilterList() {
  const term = el.tfSearch.value.trim().toLowerCase();
  const rows = state.availableTags.filter((tag) => {
    if (!term) return true;
    return tag.name.toLowerCase().includes(term)
      || (tag.aliases || []).some((alias) => alias.toLowerCase().includes(term));
  });
  el.tfList.replaceChildren(...rows.map((tag) => {
    const row = document.createElement("label");
    row.className = "check-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.tags.includes(tag.name);
    input.onchange = () => {
      if (input.checked) {
        if (!state.tags.includes(tag.name)) state.tags.push(tag.name);
      } else {
        state.tags = state.tags.filter((name) => name !== tag.name);
      }
      renderTagBar();
      loadBooks();
    };
    const text = document.createElement("span");
    text.textContent = `${tag.name} · ${tag.kind} · ${tag.count}`;
    row.append(input, text);
    return row;
  }));
}

function renderEditorTags() {
  renderTagChips(
    el.eTags,
    state.editorTags,
    (tag) => {
      state.editorTags = state.editorTags.filter((item) => item.name !== tag.name);
      renderEditorTags();
    },
  );
}

function renderAdminList() {
  const term = el.taSearch.value.trim().toLowerCase();
  const tagsToShow = state.availableTags.filter((tag) => {
    if (!term) return true;
    return tag.name.toLowerCase().includes(term)
      || tag.kind.toLowerCase().includes(term)
      || (tag.aliases || []).some((alias) => alias.toLowerCase().includes(term));
  });
  el.taList.replaceChildren(...tagsToShow.map((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-row";
    button.textContent = `${tag.name} · ${tag.kind} · ${tag.count}`;
    button.onclick = () => {
      state.selectedTagId = tag.id;
      el.taName.value = tag.name;
      el.taKind.value = tag.kind;
      el.taDescription.value = tag.description || "";
      el.taAlias.value = "";
      el.taMergeTarget.value = "";
    };
    return button;
  }));
}

async function runTagAction(action) {
  try {
    await action();
    await loadTags();
  } catch (error) {
    toast(`Не сохранилось: ${error.message}`, true);
  }
}

async function loadTags() {
  state.availableTags = await api("/api/tags");
  el.tagsList.replaceChildren(...state.availableTags.map((tag) =>
    Object.assign(document.createElement("option"), { value: tag.name })));
  renderTagBar();
  renderFilterList();
  renderAdminList();
}

async function loadStatus() {
  const status = await api("/api/status");
  state.local = status.local !== false;
  // Удалённому гостю привилегии недоступны: не рисуем то, что вернёт 403.
  // (css: .header-remote скрывает эти кнопки).
  document.body.classList.toggle("remote", !state.local);
  const scanned = status.last_scan
    ? new Date(status.last_scan * 1000).toLocaleString("ru-RU")
    : "—";
  el.status.innerHTML = status.mounted
    ? `${status.total} ${plural(status.total, "карточка", "карточки", "карточек")}<br>`
      + `обложек ${status.covers}<br>скан ${scanned}`
    : `<span class="warn">библиотека не смонтирована</span>`
      + (status.root ? `<br>${status.root}<br>каталог показан из кэша` : "");
}

async function loadSections() {
  const sections = await api("/api/sections");
  state.sections = sections.map((item) => item.name);
  el.sectionsList.replaceChildren(...state.sections.map((name) =>
    Object.assign(document.createElement("option"), { value: name })));
  const total = sections.reduce((sum, item) => sum + item.count, 0);
  const items = [{ name: "*", label: "Все разделы", count: total }, ...sections];

  el.sections.replaceChildren(...items.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label || item.name;
    button.append(Object.assign(document.createElement("span"), { textContent: item.count }));
    button.classList.toggle("active", state.section === item.name);
    button.onclick = () => {
      state.section = item.name;
      [...el.sections.children].forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      document.body.classList.remove("nav-open");  // мобильно: раздел выбран — панель закрыть
      loadBooks();
    };
    return button;
  }));
}

function cardNode(book) {
  const card = document.createElement("article");
  card.className = "card";
  card.title = book.key;

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (book.has_cover) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = `/api/cover?key=${encodeURIComponent(book.key)}`;
    thumb.append(img);
  } else {
    thumb.append(Object.assign(document.createElement("div"), {
      className: "placeholder",
      textContent: book.title,
    }));
  }

  const edit = document.createElement("button");
  edit.className = "edit";
  edit.type = "button";
  edit.title = "Править название, автора, раздел";
  edit.textContent = "✎";
  edit.onclick = (event) => {
    event.stopPropagation();  // иначе клик уйдёт в карточку и откроет папку
    editBook(book);
  };
  thumb.append(edit);

  const formats = document.createElement("div");
  formats.className = "formats";
  formats.append(...book.formats.slice(0, 4).map((format) =>
    Object.assign(document.createElement("i"), { textContent: format })));
  thumb.append(formats);

  const title = Object.assign(document.createElement("div"), {
    className: "title",
    textContent: book.title,
  });

  const parts = [book.author, book.year, `${book.size_mb} МБ`].filter(Boolean);
  const meta = Object.assign(document.createElement("div"), {
    className: "meta",
    textContent: parts.join(" · "),
  });

  let tagsBox = null;
  if (book.tags && book.tags.length) {
    tagsBox = document.createElement("div");
    tagsBox.className = "tags";
    const visible = book.tags.slice(0, 3);
    renderTagChips(tagsBox, visible, null, (tag) => {
      state.tags = [tag.name];
      renderTagBar();
      loadBooks();
    });
    if (book.tags.length > 3) {
      const more = document.createElement("span");
      more.className = "tag-more";
      more.textContent = `+${book.tags.length - 3}`;
      more.onclick = (event) => {
        event.stopPropagation();
      };
      tagsBox.append(more);
    }
  }

  card.append(thumb, title, meta);
  if (tagsBox) {
    card.append(tagsBox);
  }
  if (book.edited) {
    card.append(Object.assign(document.createElement("div"), {
      className: "edited", textContent: "правлено",
    }));
  }
  card.onclick = () => (state.local ? openBook(book) : openFiles(book));
  return card;
}

function editBook(book) {
  el.eKey.textContent = book.key;
  el.eTitle.value = book.title || "";
  el.eAuthor.value = book.author || "";
  el.eSection.value = book.section || "";
  state.editorTags = [...(book.tags || [])];
  renderEditorTags();
  el.tagsList.replaceChildren(...state.availableTags.map((tag) =>
    Object.assign(document.createElement("option"), { value: tag.name })));
  el.editor.returnValue = "cancel";
  el.editor.showModal();

  el.editor.onclose = async () => {
    const action = el.editor.returnValue;
    if (action !== "save" && action !== "reset") return;
    try {
      const payload = action === "reset"
        ? { key: book.key, reset: true }
        : {
            key: book.key,
            title: el.eTitle.value,
            author: el.eAuthor.value,
            section: el.eSection.value,
            tags: currentTagNames(),
          };
      const result = await postJson("/api/book", payload);
      toast(result.action === "reset" ? "Правки сброшены" : "Сохранено");
      await Promise.all([loadTags(), loadSections(), loadBooks()]);
    } catch (error) {
      toast(`Не сохранилось: ${error.message}`, true);
    }
  };
}

function setPreview(message, kind = "") {
  el.sPreview.textContent = message;
  el.sPreview.className = kind;
  el.sPreview.hidden = !message;
}

async function checkRoot() {
  const value = el.sRoot.value.trim();
  setPreview("");
  el.sApply.disabled = true;
  if (!value) {
    setPreview("Укажите путь к папке библиотеки", "warn");
    return;
  }
  el.sCheck.disabled = true;
  try {
    const data = await api(`/api/settings/preview?root=${encodeURIComponent(value)}`);
    let message = `${data.files} ${plural(data.files, "файл", "файла", "файлов")}`
      + `: ${data.books} ${plural(data.books, "книжный", "книжных", "книжных")}`;
    if (data.audio) message += `, ${data.audio} аудио`;
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
    setPreview(error.message, "error");
  } finally {
    el.sCheck.disabled = false;
  }
}

const SOURCE_NAMES = {
  config: "рантайм-конфиг", env: "окружение",
  "env-file": "файл .env", default: "по умолчанию",
};

async function openSettings() {
  el.sApply.disabled = true;
  el.sRoot.disabled = true;
  el.sCurrent.textContent = "";
  el.sInfo.textContent = "";
  setPreview("");
  el.settings.showModal();

  try {
    const data = await api("/api/settings");
    el.sCurrent.textContent =
      `сейчас: ${data.root} (${SOURCE_NAMES[data.root_source] || data.root_source})`;
    el.sRoot.value = data.root;
    el.sRoot.disabled = false;
    const missing = Object.entries(data.read_only.tools)
      .filter(([, ok]) => !ok).map(([name]) => name);
    el.sInfo.textContent = missing.length
      ? `не найдены: ${missing.join(", ")} — обложки могут не генерироваться`
      : `обложки: ${data.read_only.cover_width}×${data.read_only.cover_max_height}, `
        + `требуемые утилиты на месте`;
  } catch (error) {
    // Поле снова доступно: настройки не загрузились, но путь ввести и проверить
    // всё ещё можно — иначе диалог остаётся мёртвым до закрытия и открытия.
    el.sRoot.disabled = false;
    setPreview(`Не удалось загрузить настройки: ${error.message}`, "error");
  }
}

async function applySettings() {
  el.sApply.disabled = true;
  el.sCheck.disabled = true;
  setPreview("Применяю…");
  try {
    const result = await postJson("/api/settings", { root: el.sRoot.value.trim() });
    el.settings.close();
    toast(`Корень сменён: добавлено ${result.added}, обложек ${result.covers_built}`
      + ` (${result.elapsed} с)`);
    await Promise.all([loadStatus(), loadSections(), loadBooks()]);
  } catch (error) {
    // Диалог остаётся открытым: путь уже введён, и ошибку надо показать рядом с
    // полем, а не тостом поверх витрины, которая ничего не меняла. «Применить»
    // остаётся заблокированной до повторной проверки.
    setPreview(error.message, "error");
  } finally {
    el.sCheck.disabled = false;
  }
}

async function openBook(book) {
  try {
    const result = await postJson("/api/open", { key: book.key });
    toast(`Открыто: ${result.opened || book.title}`);
  } catch (error) {
    toast(`Не удалось открыть папку: ${error.message}`, true);
  }
}

function bytesLabel(sizeMb) {
  if (sizeMb >= 1024) return `${(sizeMb / 1024).toFixed(1)} ГБ`;
  if (sizeMb >= 1) return `${sizeMb.toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(sizeMb * 1024))} КБ`;
}

async function openFiles(book) {
  el.filesTitle.textContent = book.title || book.key;
  el.filesList.textContent = "";
  el.files.showModal();
  try {
    const items = await api(`/api/files?key=${encodeURIComponent(book.key)}`);
    if (!items.length) {
      el.filesList.textContent = "файлов нет";
      return;
    }
    el.filesList.append(...items.map((item) => {
      const link = document.createElement("a");
      link.href = `/api/download?key=${encodeURIComponent(book.key)}`
        + `&file=${encodeURIComponent(item.file)}`;
      link.download = item.name;
      const name = document.createElement("span");
      name.className = "f-name";
      name.textContent = item.name;
      const meta = document.createElement("span");
      meta.className = "f-meta";
      meta.textContent = `${item.format} · ${bytesLabel(item.size_mb)}`;
      link.append(name, meta);
      return link;
    }));
  } catch (error) {
    el.filesList.textContent = `не удалось загрузить: ${error.message}`;
  }
}

async function loadBooks() {
  const params = new URLSearchParams({ section: state.section, sort: state.sort });
  if (state.q) params.set("q", state.q);
  for (const tag of state.tags) params.append("tag", tag);
  const data = await api(`/api/books?${params}`);

  el.counter.textContent = data.total
    ? `${data.total} ${plural(data.total, "книга", "книги", "книг")}`
      + (data.books.length < data.total ? `, показаны первые ${data.books.length}` : "")
    : "ничего не найдено";
  el.grid.replaceChildren(...data.books.map(cardNode));
}

function renderTagDatalist() {
  el.tagsList.replaceChildren(...state.availableTags.map((tag) =>
    Object.assign(document.createElement("option"), { value: tag.name })));
}

let searchTimer = null;
el.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = el.search.value.trim();
    loadBooks();
  }, 200);
});

el.sort.addEventListener("change", () => {
  state.sort = el.sort.value;
  loadBooks();
});

el.settingsBtn.addEventListener("click", openSettings);
el.tagsBtn.addEventListener("click", () => {
  el.tfSearch.value = "";
  renderFilterList();
  el.tagfilter.showModal();
});
el.tagsAdminBtn.addEventListener("click", () => {
  el.taSearch.value = "";
  renderAdminList();
  el.tagsadmin.showModal();
});
el.tfSearch.addEventListener("input", renderFilterList);
el.tfClear.addEventListener("click", () => {
  state.tags = [];
  renderTagBar();
  loadBooks();
});
el.tfClose.addEventListener("click", () => el.tagfilter.close());
el.taSearch.addEventListener("input", renderAdminList);
el.taClose.addEventListener("click", () => el.tagsadmin.close());
el.eTagAdd.addEventListener("click", () => {
  const value = normalizeTagName(el.eTagInput.value);
  if (!value) return;
  const tag = state.availableTags.find((item) => item.name === value);
  if (!tag || state.editorTags.some((item) => item.name === tag.name)) return;
  state.editorTags = [...state.editorTags, tag];
  el.eTagInput.value = "";
  renderEditorTags();
});
el.eTagInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    el.eTagAdd.click();
  }
});
el.taCreate.addEventListener("click", () => runTagAction(() => postJson("/api/tags", {
  name: el.taName.value,
  kind: el.taKind.value || "custom",
  description: el.taDescription.value,
})));
el.taSave.addEventListener("click", () => runTagAction(async () => {
  if (state.selectedTagId == null) return;
  await api(`/api/tags/${state.selectedTagId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: el.taName.value,
      kind: el.taKind.value,
      description: el.taDescription.value,
    }),
  });
}));
el.taAddAlias.addEventListener("click", () => runTagAction(async () => {
  if (state.selectedTagId == null) return;
  await postJson(`/api/tags/${state.selectedTagId}/aliases`, { alias: el.taAlias.value });
}));
el.taRemoveAlias.addEventListener("click", () => runTagAction(async () => {
  if (state.selectedTagId == null) return;
  await api(
    `/api/tags/${state.selectedTagId}/aliases?alias=${encodeURIComponent(el.taAlias.value)}`,
    { method: "DELETE" },
  );
}));
el.taMerge.addEventListener("click", () => runTagAction(async () => {
  if (state.selectedTagId == null) return;
  const target = state.availableTags.find((item) => item.name === el.taMergeTarget.value);
  if (!target) return;
  await postJson("/api/tags/merge", { source: state.selectedTagId, target: target.id });
}));
el.taDelete.addEventListener("click", () => runTagAction(async () => {
  if (state.selectedTagId == null) return;
  await api(`/api/tags/${state.selectedTagId}`, { method: "DELETE" });
  state.selectedTagId = null;
}));
// Единственный путь к проверке пути: и клик по «Проверить», и Enter в поле —
// это submit формы. preventDefault оставляет диалог открытым.
el.sForm.addEventListener("submit", (event) => {
  event.preventDefault();
  checkRoot();
});
el.sCancel.addEventListener("click", () => el.settings.close());
el.sApply.addEventListener("click", applySettings);
el.filesCancel.addEventListener("click", () => el.files.close());
el.burger.addEventListener("click", () => {
  document.body.classList.toggle("nav-open");
});

// Закрытие sidebar при клике на overlay (мобильная версия)
const sidebarOverlay = document.getElementById("sidebar-overlay");
if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", () => {
    document.body.classList.remove("nav-open");
  });
}
// Путь изменили после проверки — предпросмотр больше не про него, и применять
// непроверенное значение нельзя.
el.sRoot.addEventListener("input", () => {
  el.sApply.disabled = true;
  setPreview("");
});

el.rescan.addEventListener("click", async () => {
  el.rescan.disabled = true;
  el.rescan.textContent = "Сканирую…";
  try {
    const result = await api("/api/rescan", { method: "POST" });
    toast(`Добавлено ${result.added}, обновлено ${result.updated}, `
      + `пропало ${result.missing}, обложек ${result.covers_built} (${result.elapsed} с)`);
    await Promise.all([loadStatus(), loadSections(), loadBooks()]);
  } catch (error) {
    toast(`Скан не выполнен: ${error.message}`, true);
  } finally {
    el.rescan.disabled = false;
    el.rescan.textContent = "Обновить";
  }
});

(async function start() {
  try {
    await Promise.all([loadStatus(), loadTags(), loadSections(), loadBooks()]);
  } catch (error) {
    toast(`Не удалось загрузить каталог: ${error.message}`, true);
  }
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("serviceWorker registration failed:", error);
    });
  });
}

(function installPrompt() {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (isStandalone) return;

  const btn = document.getElementById("installBtn");
  if (!btn) return;

  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.hidden = false;
  });

  btn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    btn.hidden = true;
    deferredPrompt = null;
  });
})();
