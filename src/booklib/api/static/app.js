"use strict";

const state = { section: "*", q: "", sort: "title", sections: [] };

const el = {
  sections: document.getElementById("sections"),
  status: document.getElementById("status"),
  grid: document.getElementById("grid"),
  counter: document.getElementById("counter"),
  search: document.getElementById("search"),
  sort: document.getElementById("sort"),
  rescan: document.getElementById("rescan"),
  settingsBtn: document.getElementById("settingsBtn"),
  settings: document.getElementById("settings"),
  sCurrent: document.getElementById("s-current"),
  sRoot: document.getElementById("s-root"),
  sCheck: document.getElementById("s-check"),
  sPreview: document.getElementById("s-preview"),
  sInfo: document.getElementById("s-info"),
  sApply: document.getElementById("s-apply"),
  toast: document.getElementById("toast"),
  editor: document.getElementById("editor"),
  eKey: document.getElementById("e-key"),
  eTitle: document.getElementById("e-title"),
  eAuthor: document.getElementById("e-author"),
  eSection: document.getElementById("e-section"),
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
    } catch { /* тело не json — оставляем код */ }
    throw new Error(detail);
  }
  return response.json();
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

async function loadStatus() {
  const status = await api("/api/status");
  const scanned = status.last_scan
    ? new Date(status.last_scan * 1000).toLocaleString("ru-RU")
    : "—";
  el.status.innerHTML = status.mounted
    ? `${status.total} ${plural(status.total, "карточка", "карточки", "карточек")}<br>`
      + `обложек ${status.covers}<br>скан ${scanned}`
    : `<span class="warn">библиотека не смонтирована</span><br>`
      + `${status.root}<br>каталог показан из кэша`;
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

  if (book.edited) {
    card.append(Object.assign(document.createElement("div"), {
      className: "edited", textContent: "правлено",
    }));
  }

  card.append(thumb, title, meta);
  card.onclick = () => openBook(book);
  return card;
}

function editBook(book) {
  el.eKey.textContent = book.key;
  el.eTitle.value = book.title || "";
  el.eAuthor.value = book.author || "";
  el.eSection.value = book.section || "";
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
          };
      const result = await api("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast(result.action === "reset" ? "Правки сброшены" : "Сохранено");
      await Promise.all([loadSections(), loadBooks()]);
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

function openSettings() {
  el.sApply.disabled = true;
  el.sRoot.disabled = true;
  setPreview("");
  el.settings.returnValue = "cancel";
  el.settings.showModal();

  (async () => {
    try {
      const data = await api("/api/settings");
      const sourceNames = { config: "рантайм-конфиг", env: "окружение", default: "по умолчанию" };
      el.sCurrent.textContent = `сейчас: ${data.root} (${sourceNames[data.root_source] || data.root_source})`;
      el.sRoot.value = data.root;
      el.sRoot.disabled = false;
      const tools = Object.entries(data.read_only.tools);
      const missing = tools.filter(([, ok]) => !ok).map(([name]) => name);
      el.sInfo.textContent = missing.length
        ? `не найдены: ${missing.join(", ")} — обложки могут не генерироваться`
        : `обложки: ${data.read_only.cover_width}×${data.read_only.cover_max_height}, `
          + `требуемые утилиты на месте`;
    } catch (error) {
      el.sCurrent.textContent = "";
      setPreview(`Не удалось загрузить настройки: ${error.message}`, "error");
    }
  })();

  el.settings.onclose = async () => {
    if (el.settings.returnValue !== "apply") return;
    try {
      const result = await api("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: el.sRoot.value.trim() }),
      });
      toast(`Корень сменён: добавлено ${result.added}, обложек ${result.covers_built}`
        + ` (${result.elapsed} с)`);
      await Promise.all([loadStatus(), loadSections(), loadBooks()]);
    } catch (error) {
      toast(`Не применилось: ${error.message}`, true);
    }
  };
}

async function openBook(book) {
  try {
    const result = await api("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: book.key }),
    });
    toast(`Открыто: ${result.opened || book.title}`);
  } catch (error) {
    toast(`Не удалось открыть папку: ${error.message}`, true);
  }
}

async function loadBooks() {
  const params = new URLSearchParams({ section: state.section, sort: state.sort });
  if (state.q) params.set("q", state.q);
  const data = await api(`/api/books?${params}`);

  el.counter.textContent = data.total
    ? `${data.total} ${plural(data.total, "книга", "книги", "книг")}`
      + (data.books.length < data.total ? `, показаны первые ${data.books.length}` : "")
    : "ничего не найдено";
  el.grid.replaceChildren(...data.books.map(cardNode));
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
el.sCheck.addEventListener("click", checkRoot);
el.sRoot.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    checkRoot();
  }
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
    await Promise.all([loadStatus(), loadSections(), loadBooks()]);
  } catch (error) {
    toast(`Не удалось загрузить каталог: ${error.message}`, true);
  }
})();
