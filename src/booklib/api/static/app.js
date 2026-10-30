"use strict";

const {
  normalizeTagName,
  addEditorTagFromInput,
  resolveEditorSubmitAction,
} = globalThis.BooklibTagHelpers;

const {
  buildBooksQuery,
  activeFilters,
  filterSections,
  readPref,
  writePref,
  placeholderHue,
} = globalThis.BooklibUiHelpers;

const PAGE_SIZE = 120;

let storage = null;
try { storage = window.localStorage; } catch { /* приватный режим — без памяти вида */ }

const state = {
  section: "*",
  q: "",
  sort: "title",
  sections: [],
  local: true,
  hostDesktop: false,
  tags: [],
  formats: [],
  availableTags: [],
  availableFormats: [],
  editorTags: [],
  selectedTagId: null,
  view: readPref(storage, "booklib.view", ["grid", "list"], "grid"),
  density: readPref(storage, "booklib.density", ["standard", "compact"], "standard"),
  books: [],
  total: 0,
  // Номер последнего запроса каталога: ответ устаревшего запроса (пользователь
  // успел сменить фильтр) не должен перезаписать витрину.
  requestSeq: 0,
};

const el = {
  sidebar: document.getElementById("sidebar"),
  sections: document.getElementById("sections"),
  sectionSearch: document.getElementById("sectionSearch"),
  totalCount: document.getElementById("totalCount"),
  status: document.getElementById("status"),
  grid: document.getElementById("grid"),
  counter: document.getElementById("counter"),
  viewTitle: document.getElementById("viewTitle"),
  chips: document.getElementById("chips"),
  banner: document.getElementById("banner"),
  more: document.getElementById("more"),
  moreBtn: document.getElementById("moreBtn"),
  search: document.getElementById("search"),
  sort: document.getElementById("sort"),
  rescan: document.getElementById("rescan"),
  settingsBtn: document.getElementById("settingsBtn"),
  filtersBtn: document.getElementById("filtersBtn"),
  filtersBadge: document.getElementById("filtersBadge"),
  viewSwitch: document.getElementById("viewSwitch"),
  densityBtn: document.getElementById("densityBtn"),
  themeBtn: document.getElementById("themeBtn"),
  tagsAdminBtn: document.getElementById("tagsAdminBtn"),
  burger: document.getElementById("burger"),
  tagfilter: document.getElementById("tagfilter"),
  tfForm: document.getElementById("tf-form"),
  tfFormats: document.getElementById("tf-formats"),
  tfSearch: document.getElementById("tf-search"),
  tfList: document.getElementById("tf-list"),
  tfClear: document.getElementById("tf-clear"),
  tfClose: document.getElementById("tf-close"),
  tfDone: document.getElementById("tf-done"),
  tagsadmin: document.getElementById("tagsadmin"),
  taForm: document.getElementById("ta-form"),
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
  details: document.getElementById("details"),
  dClose: document.getElementById("d-close"),
  dCover: document.getElementById("d-cover"),
  dTitle: document.getElementById("d-title"),
  dAuthor: document.getElementById("d-author"),
  dProps: document.getElementById("d-props"),
  dActions: document.getElementById("d-actions"),
  dFiles: document.getElementById("d-files"),
  toast: document.getElementById("toast"),
  editor: document.getElementById("editor"),
  eForm: document.getElementById("e-form"),
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

function svgIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function currentTagNames() {
  return state.editorTags.map((tag) => tag.name);
}

function tryAddEditorTag(value) {
  const result = addEditorTagFromInput(state.availableTags, state.editorTags, value);
  if (result.error) {
    toast(result.error, true);
    return false;
  }
  state.editorTags = result.editorTags;
  el.eTagInput.value = result.inputValue;
  if (result.added) {
    renderEditorTags();
  }
  return true;
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

// ---------- фильтры: чипы, бейдж, панель ----------

function filtersChanged() {
  renderChips();
  renderFilterPanel();
  loadBooks();
}

function removeFilter(chip) {
  if (chip.kind === "section") {
    selectSection("*", state.sort);
    return;
  }
  if (chip.kind === "q") {
    state.q = "";
    el.search.value = "";
  } else if (chip.kind === "tag") {
    state.tags = state.tags.filter((name) => name !== chip.value);
  } else if (chip.kind === "format") {
    state.formats = state.formats.filter((name) => name !== chip.value);
  }
  filtersChanged();
}

function resetFilters() {
  state.q = "";
  el.search.value = "";
  state.tags = [];
  state.formats = [];
  if (state.section !== "*") {
    selectSection("*", state.sort);
    return;
  }
  filtersChanged();
}

function renderChips() {
  const chips = activeFilters(state);
  const panelCount = state.tags.length + state.formats.length;
  el.filtersBadge.hidden = panelCount === 0;
  el.filtersBadge.textContent = String(panelCount);
  if (!chips.length) {
    el.chips.replaceChildren();
    return;
  }
  const nodes = chips.map((chip) => {
    const button = make("button", "chip", chip.label);
    button.type = "button";
    button.title = "Убрать фильтр";
    button.append(make("span", "x", "✕"));
    button.onclick = () => removeFilter(chip);
    return button;
  });
  const reset = make("button", "chip reset", "Сбросить всё");
  reset.type = "button";
  reset.onclick = resetFilters;
  el.chips.replaceChildren(...nodes, reset);
}

function renderFilterPanel() {
  el.tfFormats.replaceChildren(...state.availableFormats.map((item) => {
    const button = make("button", "", item.name.toUpperCase());
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.formats.includes(item.name)));
    button.append(make("span", "count", item.count));
    button.onclick = () => {
      state.formats = state.formats.includes(item.name)
        ? state.formats.filter((name) => name !== item.name)
        : [...state.formats, item.name];
      filtersChanged();
    };
    return button;
  }));
  renderFilterList();
}

function renderFilterList() {
  const term = el.tfSearch.value.trim().toLowerCase();
  const rows = state.availableTags.filter((tag) => {
    if (!term) return true;
    return tag.name.toLowerCase().includes(term)
      || (tag.aliases || []).some((alias) => alias.toLowerCase().includes(term));
  });
  if (!rows.length) {
    el.tfList.replaceChildren(make("div", "state", state.availableTags.length
      ? "Ничего не найдено" : "Тегов пока нет"));
    return;
  }
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
      renderChips();
      loadBooks();
    };
    row.append(input, make("span", "", `${tag.name} · ${tag.kind}`), make("span", "count", tag.count));
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
    button.classList.toggle("selected", state.selectedTagId === tag.id);
    button.textContent = `${tag.name} · ${tag.kind} · ${tag.count}`;
    button.onclick = () => {
      state.selectedTagId = tag.id;
      el.taName.value = tag.name;
      el.taKind.value = tag.kind;
      el.taDescription.value = tag.description || "";
      el.taAlias.value = "";
      el.taMergeTarget.value = "";
      renderAdminList();
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
  renderTagDatalist();
  renderChips();
  renderFilterList();
  renderAdminList();
}

async function loadFormats() {
  state.availableFormats = await api("/api/formats");
  renderFilterPanel();
}

async function loadStatus() {
  const status = await api("/api/status");
  state.local = status.local !== false;
  state.hostDesktop = status.host_desktop === true;
  // Гостю привилегии недоступны: не рисуем то, что вернёт 403 (css: body.remote
  // .admin-only). Это только UI — сервер всё равно проверяет require_local.
  document.body.classList.toggle("remote", !state.local);
  const scanned = status.last_scan
    ? new Date(status.last_scan * 1000).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
    : "—";
  el.status.innerHTML = "";
  if (status.mounted) {
    el.status.textContent = `${status.covers} обложек · скан ${scanned}`;
    el.banner.hidden = true;
  } else {
    el.status.append(make("span", "warn", "библиотека не смонтирована"));
    el.banner.textContent = "Библиотека не смонтирована: каталог показан из кэша, "
      + "скачивание и открытие файлов недоступны.";
    el.banner.hidden = false;
  }
}

// ---------- навигация ----------

function viewName() {
  if (state.section !== "*") return state.section;
  return state.sort === "added" ? "Недавно добавленные" : "Все книги";
}

function renderNav() {
  const term = el.sectionSearch.value;
  const visible = filterSections(state.sections, term);
  if (!visible.length && term.trim()) {
    el.sections.replaceChildren(make("div", "empty", "Раздел не найден"));
  } else {
    el.sections.replaceChildren(...visible.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.title = item.name;
      button.append(make("span", "label", item.name), make("span", "count", item.count));
      button.classList.toggle("active", state.section === item.name);
      if (state.section === item.name) button.setAttribute("aria-current", "page");
      button.onclick = () => selectSection(item.name, state.sort === "added" ? "title" : state.sort);
      return button;
    }));
  }
  for (const node of el.sidebar.querySelectorAll(".nav-item[data-view]")) {
    const active = state.section === "*"
      && (node.dataset.view === "recent") === (state.sort === "added");
    node.classList.toggle("active", active);
  }
  el.viewTitle.textContent = viewName();
}

function closeNavOnMobile() {
  document.body.classList.remove("nav-open");  // мобильно: выбор сделан — панель закрыть
}

function selectSection(section, sort) {
  state.section = section;
  state.sort = sort;
  el.sort.value = sort;
  closeNavOnMobile();
  renderNav();
  renderChips();
  loadBooks();
}

async function loadSections() {
  const sections = await api("/api/sections");
  state.sections = sections;
  el.sectionsList.replaceChildren(...sections.map((item) =>
    Object.assign(document.createElement("option"), { value: item.name })));
  const total = sections.reduce((sum, item) => sum + item.count, 0);
  el.totalCount.textContent = total;
  renderNav();
}

// ---------- карточки ----------

function coverNode(book) {
  if (book.has_cover) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "";
    img.src = `/api/cover?key=${encodeURIComponent(book.key)}`;
    return img;
  }
  const placeholder = make("div", "placeholder");
  placeholder.style.setProperty("--ph-hue", placeholderHue(book.title));
  const top = make("div");
  top.append(make("div", "ph-title", book.title));
  if (book.author) top.append(make("div", "ph-author", book.author));
  placeholder.append(top, make("span", "ph-format", (book.formats[0] || book.kind || "").toUpperCase()));
  return placeholder;
}

function formatsNode(book) {
  const formats = make("div", "formats");
  formats.append(...book.formats.slice(0, 4).map((format) => {
    const item = make("i", "", format);
    item.dataset.format = format;
    return item;
  }));
  return formats;
}

function actionsNode(book) {
  const actions = make("div", "card-actions");
  const info = make("button", "icon-btn info");
  info.type = "button";
  info.title = "Подробнее";
  info.setAttribute("aria-label", `Подробнее: ${book.title}`);
  info.append(svgIcon("info"));
  info.onclick = (event) => {
    event.stopPropagation();  // иначе клик уйдёт в карточку и откроет папку/форматы
    openDetails(book);
  };
  actions.append(info);
  if (state.local) {
    const edit = make("button", "icon-btn edit");
    edit.type = "button";
    edit.title = "Править название, автора, раздел";
    edit.setAttribute("aria-label", `Править: ${book.title}`);
    edit.append(svgIcon("edit"));
    edit.onclick = (event) => {
      event.stopPropagation();  // иначе клик уйдёт в карточку и откроет папку
      editBook(book);
    };
    actions.append(edit);
  }
  return actions;
}

function primaryAction(node, book) {
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-label", state.hostDesktop
    ? `${book.title} — открыть в папке`
    : `${book.title} — выбрать формат для скачивания`);
  // Семантика основного клика по роли: хост — папка в nemo, иначе — лист форматов.
  node.onclick = () => (state.hostDesktop ? openBook(book) : openFiles(book));
  node.onkeydown = (event) => {
    if (event.target !== node) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      node.click();
    }
  };
}

function cardTagsNode(book) {
  if (!book.tags || !book.tags.length) return null;
  const tagsBox = make("div", "tags");
  renderTagChips(tagsBox, book.tags.slice(0, 3), null, (tag) => {
    state.tags = [tag.name];
    filtersChanged();
  });
  if (book.tags.length > 3) {
    tagsBox.append(make("span", "tag-more", `+${book.tags.length - 3}`));
  }
  return tagsBox;
}

function cardNode(book) {
  const card = make("article", "card");
  card.title = book.title;

  const thumb = make("div", "thumb");
  thumb.append(coverNode(book), actionsNode(book));
  if (book.edited) {
    thumb.append(make("div", "edited", "правлено"));
  }

  const body = make("div", "card-body");
  body.append(make("div", "title", book.title));
  const parts = [book.author, book.year].filter(Boolean);
  body.append(make("div", "meta", parts.length ? parts.join(" · ") : bytesLabel(book.size_mb)));
  body.append(formatsNode(book));
  const tagsBox = cardTagsNode(book);
  if (tagsBox) body.append(tagsBox);

  card.append(thumb, body);
  primaryAction(card, book);
  return card;
}

function rowNode(book) {
  const row = make("article", "row");
  row.title = book.title;

  const thumb = make("div", "thumb");
  thumb.append(coverNode(book));

  const main = make("div", "c-main");
  const title = make("div", "title", book.title);
  if (book.edited) title.append(make("span", "edited", "правлено"));
  main.append(title);
  if (book.author) main.append(make("div", "sub m-extra", book.author));

  const formats = make("div", "c-formats");
  formats.append(formatsNode(book), make("span", "m-extra", bytesLabel(book.size_mb)));

  row.append(
    thumb,
    main,
    make("div", "cell c-author", book.author || "—"),
    make("div", "cell c-section", book.section || "—"),
    formats,
    make("div", "cell c-size num", bytesLabel(book.size_mb)),
    actionsNode(book),
  );
  primaryAction(row, book);
  return row;
}

function listHeadNode() {
  const head = make("div", "list-head");
  const sortable = (label, sort) => {
    const button = make("button", "", label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.sort === sort));
    button.onclick = () => {
      state.sort = sort;
      el.sort.value = sort;
      renderNav();
      loadBooks();
    };
    return button;
  };
  const size = make("div", "num");
  size.append(sortable("Размер", "size"));
  const title = make("div");
  title.append(sortable("Название", "title"));
  head.append(make("div"), title, make("div", "", "Автор"), make("div", "", "Раздел"),
    make("div", "", "Форматы"), size, make("div"));
  return head;
}

function renderBookNodes(books) {
  return books.map(state.view === "list" ? rowNode : cardNode);
}

function stateNode(title, text, actionLabel, action) {
  const box = make("div", "state");
  box.append(make("h3", "", title), make("div", "", text));
  if (actionLabel) {
    const button = make("button", "btn", actionLabel);
    button.type = "button";
    button.onclick = action;
    box.append(button);
  }
  return box;
}

function renderCatalog() {
  el.grid.className = state.view === "list" ? "view-list" : "view-grid";
  el.grid.classList.toggle("compact", state.view === "grid" && state.density === "compact");
  if (!state.books.length) {
    const hasFilters = activeFilters(state).length > 0;
    el.grid.replaceChildren(stateNode(
      "Ничего не найдено",
      hasFilters ? "Попробуйте ослабить фильтры или изменить запрос." : "Каталог пуст — запустите скан.",
      hasFilters ? "Сбросить фильтры" : null,
      resetFilters,
    ));
  } else {
    const nodes = renderBookNodes(state.books);
    el.grid.replaceChildren(...(state.view === "list" ? [listHeadNode(), ...nodes] : nodes));
  }
  renderMore();
}

function renderMore() {
  const rest = state.total - state.books.length;
  el.more.hidden = rest <= 0;
  el.moreBtn.disabled = false;
  el.moreBtn.textContent = `Показать ещё ${Math.min(rest, PAGE_SIZE)} из ${rest}`;
}

function renderCounter() {
  el.counter.textContent = state.total
    ? `${state.total} ${plural(state.total, "книга", "книги", "книг")}`
    : "";
}

function renderSkeleton() {
  if (state.view !== "grid" || state.books.length) return;
  el.grid.className = "view-grid";
  el.grid.replaceChildren(...Array.from({ length: 12 }, () => {
    const card = make("div", "card skeleton");
    card.append(make("div", "thumb"));
    return card;
  }));
}

async function loadBooks() {
  const seq = ++state.requestSeq;
  // Пока первая страница нового запроса в пути, «ещё» блокируется: иначе
  // подгрузка взяла бы offset старого списка с новыми фильтрами и после ответа
  // дописала бы в новый список страницу с пропуском или дублями.
  el.moreBtn.disabled = true;
  renderSkeleton();
  try {
    const data = await api(`/api/books?${buildBooksQuery(state, 0, PAGE_SIZE)}`);
    if (seq !== state.requestSeq) return;
    state.books = data.books;
    state.total = data.total;
    renderCounter();
    renderCatalog();
  } catch (error) {
    if (seq !== state.requestSeq) return;
    state.books = [];
    state.total = 0;
    renderCounter();
    el.more.hidden = true;
    el.grid.className = "view-grid";
    el.grid.replaceChildren(stateNode(
      "Каталог не загрузился", error.message, "Повторить", loadBooks,
    ));
  }
}

async function loadMoreBooks() {
  if (el.moreBtn.disabled || state.books.length >= state.total) return;
  const seq = state.requestSeq;
  el.moreBtn.disabled = true;
  el.moreBtn.textContent = "Загружаю…";
  try {
    const data = await api(`/api/books?${buildBooksQuery(state, state.books.length, PAGE_SIZE)}`);
    if (seq !== state.requestSeq) return;
    state.books = state.books.concat(data.books);
    state.total = data.total;
    el.grid.append(...renderBookNodes(data.books));
    renderCounter();
    renderMore();
  } catch (error) {
    toast(`Не удалось загрузить ещё: ${error.message}`, true);
    renderMore();
  }
}

// ---------- правка ----------

function editBook(book) {
  if (el.details.open) el.details.close();
  el.eKey.textContent = book.key;
  el.eTitle.value = book.title || "";
  el.eAuthor.value = book.author || "";
  el.eSection.value = book.section || "";
  el.eTagInput.value = "";
  state.editorTags = [...(book.tags || [])];
  renderEditorTags();
  renderTagDatalist();
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

// ---------- настройки ----------

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
  closeNavOnMobile();
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
    await Promise.all([loadStatus(), loadSections(), loadFormats(), loadBooks()]);
  } catch (error) {
    // Диалог остаётся открытым: путь уже введён, и ошибку надо показать рядом с
    // полем, а не тостом поверх витрины, которая ничего не меняла. «Применить»
    // остаётся заблокированной до повторной проверки.
    setPreview(error.message, "error");
  } finally {
    el.sCheck.disabled = false;
  }
}

// ---------- открытие, файлы, подробности ----------

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

function fileLinkNode(book, item) {
  const link = make("a", "file-link");
  link.href = `/api/download?key=${encodeURIComponent(book.key)}`
    + `&file=${encodeURIComponent(item.file)}`;
  link.download = item.name;
  link.append(
    make("span", "fmt", item.format),
    make("span", "f-name", item.name),
    make("span", "f-meta", bytesLabel(item.size_mb)),
    svgIcon("download"),
  );
  return link;
}

async function fillFiles(container, book) {
  container.replaceChildren(make("div", "f-meta", "загружаю…"));
  try {
    const items = await api(`/api/files?key=${encodeURIComponent(book.key)}`);
    container.replaceChildren(...(items.length
      ? items.map((item) => fileLinkNode(book, item))
      : [make("div", "f-meta", "файлов нет")]));
  } catch (error) {
    container.replaceChildren(make("div", "f-meta", `не удалось загрузить: ${error.message}`));
  }
}

function openFiles(book) {
  el.filesTitle.textContent = book.title || book.key;
  el.files.showModal();
  return fillFiles(el.filesList, book);
}

function openDetails(book) {
  el.dCover.replaceChildren(coverNode(book));
  el.dTitle.textContent = book.title;
  el.dAuthor.textContent = book.author || "автор не указан";
  el.dAuthor.hidden = false;

  const props = [
    ["Раздел", book.section || "—"],
    ["Год", book.year || "—"],
    ["Форматы", book.formats.map((format) => format.toUpperCase()).join(", ")],
    ["Размер", bytesLabel(book.size_mb)],
    ["Путь", book.key],
  ];
  if (book.edited) props.push(["Правки", "есть ручные правки"]);
  el.dProps.replaceChildren(...props.flatMap(([name, value]) =>
    [make("dt", "", name), make("dd", "", value)]));
  if (book.tags && book.tags.length) {
    const tagsBox = make("dd", "tags");
    renderTagChips(tagsBox, book.tags, null, (tag) => {
      el.details.close();
      state.tags = [tag.name];
      filtersChanged();
    });
    el.dProps.append(make("dt", "", "Теги"), tagsBox);
  }

  const actions = [];
  if (state.hostDesktop) {
    const open = make("button", "btn primary", "Открыть в папке");
    open.type = "button";
    open.prepend(svgIcon("folder"));
    open.onclick = () => openBook(book);
    actions.push(open);
  }
  if (state.local) {
    const edit = make("button", "btn", "Править");
    edit.type = "button";
    edit.prepend(svgIcon("edit"));
    edit.onclick = () => editBook(book);
    actions.push(edit);
  }
  el.dActions.replaceChildren(...actions);
  el.dActions.hidden = !actions.length;

  el.details.showModal();
  el.dClose.focus();
  fillFiles(el.dFiles, book);
}

function renderTagDatalist() {
  el.tagsList.replaceChildren(...state.availableTags.map((tag) =>
    Object.assign(document.createElement("option"), { value: tag.name })));
}

// ---------- вид: тема, сетка/список, плотность, сайдбар ----------

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = el.themeBtn.querySelector("use");
  icon.setAttribute("href", theme === "light" ? "#i-moon" : "#i-sun");
  el.themeBtn.title = theme === "light" ? "Тёмная тема" : "Светлая тема";
  el.themeBtn.setAttribute("aria-label", el.themeBtn.title);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#eeebe3" : "#1c1f25";
}

function applyView() {
  for (const button of el.viewSwitch.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.view));
  }
  el.densityBtn.hidden = state.view !== "grid";
  el.densityBtn.setAttribute("aria-pressed", String(state.density === "compact"));
}

function isMobile() {
  return window.matchMedia("(max-width: 700px)").matches;
}

let searchTimer = null;
el.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = el.search.value.trim();
    renderChips();
    loadBooks();
  }, 250);
});
el.search.addEventListener("keydown", (event) => {
  if (event.key === "Enter") el.search.blur();  // мобильно: спрятать клавиатуру
});

el.sort.addEventListener("change", () => {
  state.sort = el.sort.value;
  renderNav();
  loadBooks();
});

el.sectionSearch.addEventListener("input", renderNav);
el.sectionSearch.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const first = filterSections(state.sections, el.sectionSearch.value)[0];
  if (first) selectSection(first.name, state.sort === "added" ? "title" : state.sort);
});

for (const node of el.sidebar.querySelectorAll(".nav-item[data-view]")) {
  node.addEventListener("click", () => {
    selectSection("*", node.dataset.view === "recent" ? "added" : "title");
  });
}

el.viewSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mode]");
  if (!button || button.dataset.mode === state.view) return;
  state.view = button.dataset.mode;
  writePref(storage, "booklib.view", state.view);
  applyView();
  renderCatalog();
});

el.densityBtn.addEventListener("click", () => {
  state.density = state.density === "compact" ? "standard" : "compact";
  writePref(storage, "booklib.density", state.density);
  applyView();
  renderCatalog();
});

el.themeBtn.addEventListener("click", () => {
  const theme = currentTheme() === "light" ? "dark" : "light";
  writePref(storage, "booklib.theme", theme);
  applyTheme(theme);
});

el.moreBtn.addEventListener("click", loadMoreBooks);
if ("IntersectionObserver" in window) {
  // Подгрузка при прокрутке к концу; кнопка остаётся для клавиатуры и как запасной путь.
  new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadMoreBooks();
  }, { rootMargin: "600px 0px" }).observe(el.more);
}

el.settingsBtn.addEventListener("click", openSettings);
// Формы теговых диалогов — только контейнеры разметки. Без method="dialog" Enter
// в единственном текстовом поле уходит implicit submit'ом в GET на текущий URL и
// перезагружает витрину; у #ta-form сегодня не срабатывает лишь из-за числа полей
// (спека отменяет implicit submission при >1 блокирующем поле) — на это опираться нельзя.
el.tfForm.addEventListener("submit", (event) => event.preventDefault());
el.taForm.addEventListener("submit", (event) => event.preventDefault());
el.filtersBtn.addEventListener("click", () => {
  el.tfSearch.value = "";
  renderFilterPanel();
  el.tagfilter.showModal();
});
el.tagsAdminBtn.addEventListener("click", () => {
  closeNavOnMobile();
  el.taSearch.value = "";
  renderAdminList();
  el.tagsadmin.showModal();
});
el.tfSearch.addEventListener("input", renderFilterList);
el.tfClear.addEventListener("click", () => {
  state.tags = [];
  state.formats = [];
  filtersChanged();
});
el.tfClose.addEventListener("click", () => el.tagfilter.close());
el.tfDone.addEventListener("click", () => el.tagfilter.close());
el.taSearch.addEventListener("input", renderAdminList);
el.taClose.addEventListener("click", () => el.tagsadmin.close());
el.dClose.addEventListener("click", () => el.details.close());
el.eTagAdd.addEventListener("click", () => {
  const value = normalizeTagName(el.eTagInput.value);
  if (!value) return;
  tryAddEditorTag(value);
});
el.eTagInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    el.eTagAdd.click();
  }
});
el.eForm.addEventListener("submit", (event) => {
  const action = resolveEditorSubmitAction(event);
  if (action !== "save") return;
  event.preventDefault();
  if (!tryAddEditorTag(el.eTagInput.value)) return;
  el.editor.close("save");
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

// Клик по фону закрывает диалоги-панели (у нативного dialog фон — сам элемент).
for (const dialog of [el.files, el.details, el.tagfilter, el.tagsadmin]) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

el.burger.addEventListener("click", () => {
  if (isMobile()) {
    document.body.classList.toggle("nav-open");
    return;
  }
  const collapsed = document.body.classList.toggle("nav-collapsed");
  writePref(storage, "booklib.sidebar", collapsed ? "collapsed" : "open");
});

// Закрытие sidebar при клике на overlay (мобильная версия)
const sidebarOverlay = document.getElementById("sidebar-overlay");
if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", closeNavOnMobile);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("nav-open")) {
    closeNavOnMobile();
    return;
  }
  // «/» — к поиску, как в большинстве каталогов; не перехватываем ввод в полях.
  const target = event.target instanceof Element ? event.target : null;
  if (event.key === "/" && !target?.closest("input, textarea, select, dialog")) {
    event.preventDefault();
    el.search.focus();
  }
});

// Путь изменили после проверки — предпросмотр больше не про него, и применять
// непроверенное значение нельзя.
el.sRoot.addEventListener("input", () => {
  el.sApply.disabled = true;
  setPreview("");
});

el.rescan.addEventListener("click", async () => {
  const label = el.rescan.querySelector(".label-wide");
  el.rescan.disabled = true;
  label.textContent = "Сканирую…";
  try {
    const result = await api("/api/rescan", { method: "POST" });
    toast(`Добавлено ${result.added}, обновлено ${result.updated}, `
      + `пропало ${result.missing}, обложек ${result.covers_built} (${result.elapsed} с)`);
    await Promise.all([loadStatus(), loadSections(), loadFormats(), loadBooks()]);
  } catch (error) {
    toast(`Скан не выполнен: ${error.message}`, true);
  } finally {
    el.rescan.disabled = false;
    label.textContent = "Обновить";
  }
});

(async function start() {
  if (readPref(storage, "booklib.sidebar", ["open", "collapsed"], "open") === "collapsed") {
    document.body.classList.add("nav-collapsed");
  }
  applyTheme(currentTheme());
  applyView();
  renderNav();
  // Статус первым: роль (host/LAN/гость) решает, что делает клик по карточке
  // и рисовать ли кнопку правки, поэтому карточки строятся после него.
  try {
    await loadStatus();
  } catch (error) {
    // Роль неизвестна — fail closed: ведём себя как гость (форматы, без правки).
    state.local = false;
    state.hostDesktop = false;
    document.body.classList.add("remote");
    toast(`Не удалось получить статус: ${error.message}`, true);
  }
  // loadBooks сам рисует состояние ошибки, остальное — тостом.
  const results = await Promise.allSettled([loadTags(), loadSections(), loadFormats(), loadBooks()]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
    toast(`Не удалось загрузить каталог: ${failed.reason.message}`, true);
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
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    btn.hidden = true;
    deferredPrompt = null;
  });
})();
