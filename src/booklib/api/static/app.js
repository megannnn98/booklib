"use strict";
(() => {
  // frontend/src/api.ts
  var PUBLIC_GET = [
    /^\/api\/status$/,
    /^\/api\/sections$/,
    /^\/api\/formats$/,
    /^\/api\/books(?:\?|$)/,
    /^\/api\/cover(?:\?|$)/,
    /^\/api\/files(?:\?|$)/,
    /^\/api\/download(?:\?|$)/,
    /^\/api\/tags$/
  ];
  function isPrivilegedRequest(method, path) {
    if (method.toUpperCase() !== "GET") {
      return true;
    }
    return !PUBLIC_GET.some((pattern) => pattern.test(path));
  }
  async function errorMessage(response) {
    let detail = `HTTP ${response.status}`;
    try {
      const parsed = await response.json();
      if (typeof parsed === "object" && parsed !== null) {
        const body = parsed;
        if (body.error) {
          detail = body.error;
        } else if (body.detail) {
          detail = body.detail;
        }
        if (typeof body.count === "number") {
          detail = `${detail} (${body.count})`;
        }
      }
    } catch {
    }
    return detail;
  }
  function createApi(fetchImpl = (input, init) => fetch(input, init)) {
    async function request(path, method, payload, extraHeaders) {
      const headers = { ...extraHeaders };
      if (isPrivilegedRequest(method, path)) {
        headers["X-Booklib"] = "1";
      }
      const init = { method, headers };
      if (payload !== void 0) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(payload);
      }
      const response = await fetchImpl(path, init);
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
      return await response.json();
    }
    return {
      get: (path) => request(path, "GET"),
      send: (path, method, payload, extraHeaders) => request(path, method, payload, extraHeaders)
    };
  }

  // frontend/src/ui_helpers.ts
  function buildBooksQuery(filters, offset, limit) {
    const params = new URLSearchParams({ section: filters.section, sort: filters.sort });
    if (filters.q) {
      params.set("q", filters.q);
    }
    for (const tag of filters.tags) {
      params.append("tag", tag);
    }
    for (const format of filters.formats) {
      params.append("format", format);
    }
    params.set("limit", String(limit));
    params.set("offset", String(offset));
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
    if (!needle) {
      return [...sections];
    }
    return sections.filter((item) => item.name.toLowerCase().includes(needle));
  }
  function readPref(storage2, key, allowed, fallback) {
    try {
      const value = storage2 ? storage2.getItem(key) : null;
      return allowed.find((candidate) => candidate === value) ?? fallback;
    } catch {
      return fallback;
    }
  }
  function writePref(storage2, key, value) {
    try {
      storage2?.setItem(key, value);
    } catch {
    }
  }
  function placeholderHue(text) {
    let hash = 0;
    for (const char of String(text ?? "")) {
      hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
    }
    return hash;
  }

  // frontend/src/catalog_state.ts
  var VIEW_MODES = ["grid", "list"];
  var DENSITIES = ["standard", "compact"];
  function createState(storage2, overrides = {}) {
    return {
      section: "*",
      q: "",
      sort: "title",
      tags: [],
      formats: [],
      sections: [],
      local: true,
      hostDesktop: false,
      availableTags: [],
      availableFormats: [],
      editorTags: [],
      selectedTagId: null,
      view: readPref(storage2, "booklib.view", VIEW_MODES, "grid"),
      density: readPref(storage2, "booklib.density", DENSITIES, "standard"),
      books: [],
      total: 0,
      requestSeq: 0,
      ...overrides
    };
  }
  function viewName(state) {
    if (state.section !== "*") {
      return state.section;
    }
    return state.sort === "added" ? "Недавно добавленные" : "Все книги";
  }
  function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) {
      return one;
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return few;
    }
    return many;
  }
  function bytesLabel(sizeMb) {
    if (sizeMb >= 1024) {
      return `${(sizeMb / 1024).toFixed(1)} ГБ`;
    }
    if (sizeMb >= 1) {
      return `${sizeMb.toFixed(1)} МБ`;
    }
    return `${Math.max(1, Math.round(sizeMb * 1024))} КБ`;
  }
  function bookMeta(book) {
    const parts = [book.author, book.year].filter(
      (part) => part !== null && part !== void 0 && part !== ""
    );
    return parts.length ? parts.join(" · ") : bytesLabel(book.size_mb);
  }
  function restCount(state) {
    return state.total - state.books.length;
  }
  function moreLabel(state, pageSize) {
    const rest = restCount(state);
    if (rest <= 0) {
      return null;
    }
    return `Показать ещё ${Math.min(rest, pageSize)} из ${rest}`;
  }
  function toggleFormat(state, name) {
    state.formats = state.formats.includes(name) ? state.formats.filter((item) => item !== name) : [...state.formats, name];
  }
  function removeChip(state, chip) {
    switch (chip.kind) {
      case "section":
        state.section = "*";
        return;
      case "q":
        state.q = "";
        return;
      case "tag":
        state.tags = state.tags.filter((name) => name !== chip.value);
        return;
      case "format":
        state.formats = state.formats.filter((name) => name !== chip.value);
        return;
    }
  }
  function clearPanelFilters(state) {
    state.tags = [];
    state.formats = [];
  }
  function resetAllFilters(state) {
    state.q = "";
    state.tags = [];
    state.formats = [];
    state.section = "*";
  }
  function sectionSort(sort) {
    return sort === "added" ? "title" : sort;
  }

  // frontend/src/dom.ts
  function need(doc, id) {
    const node = doc.getElementById(id);
    if (!node) {
      throw new Error(`booklib: в разметке нет элемента #${id}`);
    }
    return node;
  }
  function findElements(doc) {
    return {
      sidebar: need(doc, "sidebar"),
      sections: need(doc, "sections"),
      sectionSearch: need(doc, "sectionSearch"),
      totalCount: need(doc, "totalCount"),
      status: need(doc, "status"),
      grid: need(doc, "grid"),
      counter: need(doc, "counter"),
      viewTitle: need(doc, "viewTitle"),
      chips: need(doc, "chips"),
      banner: need(doc, "banner"),
      more: need(doc, "more"),
      moreBtn: need(doc, "moreBtn"),
      search: need(doc, "search"),
      sort: need(doc, "sort"),
      rescan: need(doc, "rescan"),
      settingsBtn: need(doc, "settingsBtn"),
      filtersBtn: need(doc, "filtersBtn"),
      filtersBadge: need(doc, "filtersBadge"),
      viewSwitch: need(doc, "viewSwitch"),
      densityBtn: need(doc, "densityBtn"),
      themeBtn: need(doc, "themeBtn"),
      tagsAdminBtn: need(doc, "tagsAdminBtn"),
      burger: need(doc, "burger"),
      installBtn: need(doc, "installBtn"),
      sidebarOverlay: doc.getElementById("sidebar-overlay"),
      tagfilter: need(doc, "tagfilter"),
      tfForm: need(doc, "tf-form"),
      tfFormats: need(doc, "tf-formats"),
      tfSearch: need(doc, "tf-search"),
      tfList: need(doc, "tf-list"),
      tfClear: need(doc, "tf-clear"),
      tfClose: need(doc, "tf-close"),
      tfDone: need(doc, "tf-done"),
      tagsadmin: need(doc, "tagsadmin"),
      taForm: need(doc, "ta-form"),
      taSearch: need(doc, "ta-search"),
      taList: need(doc, "ta-list"),
      taName: need(doc, "ta-name"),
      taKind: need(doc, "ta-kind"),
      taDescription: need(doc, "ta-description"),
      taAlias: need(doc, "ta-alias"),
      taMergeTarget: need(doc, "ta-merge-target"),
      taCreate: need(doc, "ta-create"),
      taSave: need(doc, "ta-save"),
      taAddAlias: need(doc, "ta-add-alias"),
      taRemoveAlias: need(doc, "ta-remove-alias"),
      taMerge: need(doc, "ta-merge"),
      taDelete: need(doc, "ta-delete"),
      taClose: need(doc, "ta-close"),
      settings: need(doc, "settings"),
      sCurrent: need(doc, "s-current"),
      sForm: need(doc, "s-form"),
      sRoot: need(doc, "s-root"),
      sCheck: need(doc, "s-check"),
      sCancel: need(doc, "s-cancel"),
      sPreview: need(doc, "s-preview"),
      sInfo: need(doc, "s-info"),
      sApply: need(doc, "s-apply"),
      files: need(doc, "files"),
      filesTitle: need(doc, "files-title"),
      filesList: need(doc, "files-list"),
      filesCancel: need(doc, "files-cancel"),
      details: need(doc, "details"),
      dClose: need(doc, "d-close"),
      dCover: need(doc, "d-cover"),
      dTitle: need(doc, "d-title"),
      dAuthor: need(doc, "d-author"),
      dProps: need(doc, "d-props"),
      dActions: need(doc, "d-actions"),
      dFiles: need(doc, "d-files"),
      toast: need(doc, "toast"),
      editor: need(doc, "editor"),
      eForm: need(doc, "e-form"),
      eKey: need(doc, "e-key"),
      eTitle: need(doc, "e-title"),
      eAuthor: need(doc, "e-author"),
      eSection: need(doc, "e-section"),
      eTags: need(doc, "e-tags"),
      eTagInput: need(doc, "e-tag-input"),
      eTagAdd: need(doc, "e-tag-add"),
      eSave: need(doc, "e-save"),
      tagsList: need(doc, "tags-list"),
      sectionsList: need(doc, "sections-list")
    };
  }
  function make(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== void 0 && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgIcon(doc, name) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = doc.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
  }

  // frontend/src/tag_chips.ts
  function renderTagChips(doc, container, items, handlers) {
    container.replaceChildren(
      ...items.map((item) => {
        const chip = make(doc, "button", "tag-chip", item.name);
        chip.type = "button";
        if (item.kind) {
          chip.dataset.kind = item.kind;
        }
        if (handlers.onClick) {
          const onClick = handlers.onClick;
          chip.onclick = (event) => {
            event.stopPropagation();
            onClick(item);
          };
        }
        if (handlers.onRemove) {
          const onRemove = handlers.onRemove;
          const remove = make(doc, "span", "tag-x", "✕");
          remove.onclick = (event) => {
            event.stopPropagation();
            onRemove(item);
          };
          chip.append(remove);
        }
        return chip;
      })
    );
  }

  // frontend/src/cards.ts
  function createCards(deps) {
    const { doc, state } = deps;
    function coverNode(book) {
      if (book.has_cover) {
        const img = doc.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "";
        img.src = `/api/cover?key=${encodeURIComponent(book.key)}`;
        return img;
      }
      const placeholder = make(doc, "div", "placeholder");
      placeholder.style.setProperty("--ph-hue", String(placeholderHue(book.title)));
      const top = make(doc, "div");
      top.append(make(doc, "div", "ph-title", book.title));
      if (book.author) {
        top.append(make(doc, "div", "ph-author", book.author));
      }
      const format = book.formats[0] ?? book.kind;
      placeholder.append(top, make(doc, "span", "ph-format", format.toUpperCase()));
      return placeholder;
    }
    function formatsNode(book) {
      const formats = make(doc, "div", "formats");
      formats.append(
        ...book.formats.slice(0, 4).map((format) => {
          const item = make(doc, "i", "", format);
          item.dataset.format = format;
          return item;
        })
      );
      return formats;
    }
    function actionsNode(book) {
      const actions = make(doc, "div", "card-actions");
      const info = make(doc, "button", "icon-btn info");
      info.type = "button";
      info.title = "Подробнее";
      info.setAttribute("aria-label", `Подробнее: ${book.title}`);
      info.append(svgIcon(doc, "info"));
      info.onclick = (event) => {
        event.stopPropagation();
        deps.openDetails(book);
      };
      actions.append(info);
      if (state.local) {
        const edit = make(doc, "button", "icon-btn edit");
        edit.type = "button";
        edit.title = "Править название, автора, раздел";
        edit.setAttribute("aria-label", `Править: ${book.title}`);
        edit.append(svgIcon(doc, "edit"));
        edit.onclick = (event) => {
          event.stopPropagation();
          deps.editBook(book);
        };
        actions.append(edit);
      }
      return actions;
    }
    function primaryAction(node, book) {
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.setAttribute(
        "aria-label",
        state.hostDesktop ? `${book.title} — открыть в папке` : `${book.title} — выбрать формат для скачивания`
      );
      node.onclick = () => state.hostDesktop ? deps.openBook(book) : deps.openFiles(book);
      node.onkeydown = (event) => {
        if (event.target !== node) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          node.click();
        }
      };
    }
    function cardTagsNode(book) {
      if (!book.tags.length) {
        return null;
      }
      const tagsBox = make(doc, "div", "tags");
      renderTagChips(doc, tagsBox, book.tags.slice(0, 3), {
        onClick: (tag) => deps.applyTagFilter(tag.name)
      });
      if (book.tags.length > 3) {
        tagsBox.append(make(doc, "span", "tag-more", `+${book.tags.length - 3}`));
      }
      return tagsBox;
    }
    function cardNode(book) {
      const card = make(doc, "article", "card");
      card.title = book.title;
      const thumb = make(doc, "div", "thumb");
      thumb.append(coverNode(book), actionsNode(book));
      if (book.edited) {
        thumb.append(make(doc, "div", "edited", "правлено"));
      }
      const body = make(doc, "div", "card-body");
      body.append(make(doc, "div", "title", book.title));
      body.append(make(doc, "div", "meta", bookMeta(book)));
      body.append(formatsNode(book));
      const tagsBox = cardTagsNode(book);
      if (tagsBox) {
        body.append(tagsBox);
      }
      card.append(thumb, body);
      primaryAction(card, book);
      return card;
    }
    function rowNode(book) {
      const row = make(doc, "article", "row");
      row.title = book.title;
      const thumb = make(doc, "div", "thumb");
      thumb.append(coverNode(book));
      const main = make(doc, "div", "c-main");
      const title = make(doc, "div", "title", book.title);
      if (book.edited) {
        title.append(make(doc, "span", "edited", "правлено"));
      }
      main.append(title);
      if (book.author) {
        main.append(make(doc, "div", "sub m-extra", book.author));
      }
      const formats = make(doc, "div", "c-formats");
      formats.append(formatsNode(book), make(doc, "span", "m-extra", bytesLabel(book.size_mb)));
      row.append(
        thumb,
        main,
        make(doc, "div", "cell c-author", book.author || "—"),
        make(doc, "div", "cell c-section", book.section || "—"),
        formats,
        make(doc, "div", "cell c-size num", bytesLabel(book.size_mb)),
        actionsNode(book)
      );
      primaryAction(row, book);
      return row;
    }
    function listHeadNode() {
      const head = make(doc, "div", "list-head");
      const sortable = (label, sort) => {
        const button = make(doc, "button", "", label);
        button.type = "button";
        button.setAttribute("aria-pressed", String(state.sort === sort));
        button.onclick = () => deps.sortBy(sort);
        return button;
      };
      const size = make(doc, "div", "num");
      size.append(sortable("Размер", "size"));
      const title = make(doc, "div");
      title.append(sortable("Название", "title"));
      head.append(
        make(doc, "div"),
        title,
        make(doc, "div", "", "Автор"),
        make(doc, "div", "", "Раздел"),
        make(doc, "div", "", "Форматы"),
        size,
        make(doc, "div")
      );
      return head;
    }
    function renderBookNodes(books) {
      return books.map((book) => state.view === "list" ? rowNode(book) : cardNode(book));
    }
    function stateNode(title, text, actionLabel, action) {
      const box = make(doc, "div", "state");
      box.append(make(doc, "h3", "", title), make(doc, "div", "", text));
      if (actionLabel && action) {
        const button = make(doc, "button", "btn", actionLabel);
        button.type = "button";
        button.onclick = action;
        box.append(button);
      }
      return box;
    }
    function skeletonNodes(count) {
      return Array.from({ length: count }, () => {
        const card = make(doc, "div", "card skeleton");
        card.append(make(doc, "div", "thumb"));
        return card;
      });
    }
    return {
      coverNode,
      cardNode,
      rowNode,
      listHeadNode,
      renderBookNodes,
      skeletonNodes,
      stateNode
    };
  }

  // frontend/src/catalog.ts
  function createCatalog(deps) {
    const { el, state, cards } = deps;
    function renderCounter() {
      el.counter.textContent = state.total ? `${state.total} ${plural(state.total, "книга", "книги", "книг")}` : "";
    }
    function renderMore() {
      el.more.hidden = restCount(state) <= 0;
      el.moreBtn.disabled = false;
      const label = moreLabel(state, deps.pageSize);
      if (label) {
        el.moreBtn.textContent = label;
      }
    }
    function renderCatalog() {
      el.grid.className = state.view === "list" ? "view-list" : "view-grid";
      el.grid.classList.toggle("compact", state.view === "grid" && state.density === "compact");
      if (!state.books.length) {
        const hasFilters = activeFilters(state).length > 0;
        el.grid.replaceChildren(
          cards.stateNode(
            "Ничего не найдено",
            hasFilters ? "Попробуйте ослабить фильтры или изменить запрос." : "Каталог пуст — запустите скан.",
            hasFilters ? "Сбросить фильтры" : null,
            hasFilters ? deps.onResetFilters : null
          )
        );
      } else {
        const nodes = cards.renderBookNodes(state.books);
        el.grid.replaceChildren(
          ...state.view === "list" ? [cards.listHeadNode(), ...nodes] : nodes
        );
      }
      renderMore();
    }
    function renderSkeleton() {
      if (state.view !== "grid" || state.books.length) {
        return;
      }
      el.grid.className = "view-grid";
      el.grid.replaceChildren(...cards.skeletonNodes(12));
    }
    async function loadBooks() {
      const sequence = state.requestSeq += 1;
      el.moreBtn.disabled = true;
      renderSkeleton();
      try {
        const data = await deps.api.get(
          `/api/books?${buildBooksQuery(state, 0, deps.pageSize)}`
        );
        if (sequence !== state.requestSeq) {
          return;
        }
        state.books = data.books;
        state.total = data.total;
        renderCounter();
        renderCatalog();
      } catch (error) {
        if (sequence !== state.requestSeq) {
          return;
        }
        state.books = [];
        state.total = 0;
        renderCounter();
        el.more.hidden = true;
        el.grid.className = "view-grid";
        el.grid.replaceChildren(
          cards.stateNode("Каталог не загрузился", error.message, "Повторить", () => {
            void loadBooks();
          })
        );
      }
    }
    async function loadMoreBooks() {
      if (el.moreBtn.disabled || state.books.length >= state.total) {
        return;
      }
      const sequence = state.requestSeq;
      el.moreBtn.disabled = true;
      el.moreBtn.textContent = "Загружаю…";
      try {
        const data = await deps.api.get(
          `/api/books?${buildBooksQuery(state, state.books.length, deps.pageSize)}`
        );
        if (sequence !== state.requestSeq) {
          return;
        }
        state.books = state.books.concat(data.books);
        state.total = data.total;
        el.grid.append(...cards.renderBookNodes(data.books));
        renderCounter();
        renderMore();
      } catch (error) {
        if (sequence !== state.requestSeq) {
          return;
        }
        deps.toast.show(`Не удалось загрузить ещё: ${error.message}`, true);
        renderMore();
      }
    }
    return { loadBooks, loadMoreBooks, renderCatalog, renderCounter, renderMore };
  }

  // frontend/src/details.ts
  function createDetails(deps) {
    const { doc, el, state } = deps;
    function props(book) {
      const rows = [
        ["Раздел", book.section || "—"],
        ["Год", book.year ? String(book.year) : "—"],
        ["Форматы", book.formats.map((format) => format.toUpperCase()).join(", ")],
        ["Размер", bytesLabel(book.size_mb)],
        ["Путь", book.key]
      ];
      if (book.edited) {
        rows.push(["Правки", "есть ручные правки"]);
      }
      return rows;
    }
    function openDetails(book) {
      el.dCover.replaceChildren(deps.cards.coverNode(book));
      el.dTitle.textContent = book.title;
      el.dAuthor.textContent = book.author || "автор не указан";
      el.dAuthor.hidden = false;
      el.dProps.replaceChildren(
        ...props(book).flatMap(([name, value]) => [
          make(doc, "dt", "", name),
          make(doc, "dd", "", value)
        ])
      );
      if (book.tags.length) {
        const tagsBox = make(doc, "dd", "tags");
        renderTagChips(doc, tagsBox, book.tags, {
          onClick: (tag) => {
            el.details.close();
            deps.applyTagFilter(tag.name);
          }
        });
        el.dProps.append(make(doc, "dt", "", "Теги"), tagsBox);
      }
      const actions = [];
      if (state.hostDesktop) {
        const open = make(doc, "button", "btn primary", "Открыть в папке");
        open.type = "button";
        open.prepend(svgIcon(doc, "folder"));
        open.onclick = () => deps.openBook(book);
        actions.push(open);
      }
      if (state.local) {
        const edit = make(doc, "button", "btn", "Править");
        edit.type = "button";
        edit.prepend(svgIcon(doc, "edit"));
        edit.onclick = () => deps.editBook(book);
        actions.push(edit);
      }
      el.dActions.replaceChildren(...actions);
      el.dActions.hidden = !actions.length;
      el.details.showModal();
      el.dClose.focus();
      void deps.fillFiles(el.dFiles, book);
    }
    return { openDetails };
  }

  // frontend/src/tag_helpers.ts
  function normalizeTagName(value) {
    return value.trim();
  }
  function findAvailableTag(availableTags, value) {
    const needle = normalizeTagName(value).toLowerCase();
    if (!needle) {
      return null;
    }
    return availableTags.find(
      (item) => item.name.toLowerCase() === needle || (item.aliases ?? []).some((alias) => alias.toLowerCase() === needle)
    ) ?? null;
  }
  function addEditorTagFromInput(availableTags, editorTags, value) {
    const normalized = normalizeTagName(value);
    if (!normalized) {
      return { added: false, editorTags, inputValue: value, error: null };
    }
    const tag = findAvailableTag(availableTags, normalized);
    if (!tag) {
      return {
        added: false,
        editorTags,
        inputValue: value,
        error: `Нет такого тега: ${normalized}`
      };
    }
    if (editorTags.some((item) => item.name === tag.name)) {
      return { added: false, editorTags, inputValue: "", error: null };
    }
    return { added: true, editorTags: [...editorTags, tag], inputValue: "", error: null };
  }
  function resolveEditorSubmitAction(event) {
    if (!("submitter" in event)) {
      return null;
    }
    const { submitter } = event;
    if (submitter == null) {
      return "save";
    }
    return submitter.value || null;
  }

  // frontend/src/editor.ts
  function createEditor(deps) {
    const { doc, el, state } = deps;
    function renderTagDatalist() {
      el.tagsList.replaceChildren(
        ...state.availableTags.map((tag) => {
          const option = doc.createElement("option");
          option.value = tag.name;
          return option;
        })
      );
    }
    function renderEditorTags() {
      renderTagChips(doc, el.eTags, state.editorTags, {
        onRemove: (tag) => {
          state.editorTags = state.editorTags.filter((item) => item.name !== tag.name);
          renderEditorTags();
        }
      });
    }
    function tryAddEditorTag(value) {
      const result = addEditorTagFromInput(state.availableTags, state.editorTags, value);
      if (result.error) {
        deps.toast.show(result.error, true);
        return false;
      }
      state.editorTags = [...result.editorTags];
      el.eTagInput.value = result.inputValue;
      if (result.added) {
        renderEditorTags();
      }
      return true;
    }
    function currentTagNames() {
      return state.editorTags.map((tag) => tag.name);
    }
    async function save(action, book) {
      try {
        const payload = action === "reset" ? { key: book.key, reset: true } : {
          key: book.key,
          title: el.eTitle.value,
          author: el.eAuthor.value,
          section: el.eSection.value,
          tags: currentTagNames()
        };
        const result = await deps.api.send("/api/book", "POST", payload);
        deps.toast.show(result.action === "reset" ? "Правки сброшены" : "Сохранено");
        await Promise.all([deps.loadTags(), deps.loadSections(), deps.loadBooks()]);
      } catch (error) {
        deps.toast.show(`Не сохранилось: ${error.message}`, true);
      }
    }
    function editBook(book) {
      if (el.details.open) {
        el.details.close();
      }
      el.eKey.textContent = book.key;
      el.eTitle.value = book.title || "";
      el.eAuthor.value = book.author || "";
      el.eSection.value = book.section || "";
      el.eTagInput.value = "";
      state.editorTags = [...book.tags];
      renderEditorTags();
      renderTagDatalist();
      el.editor.returnValue = "cancel";
      el.editor.showModal();
      el.editor.onclose = () => {
        const action = el.editor.returnValue;
        if (action !== "save" && action !== "reset") {
          return;
        }
        void save(action, book);
      };
    }
    function bind() {
      el.eTagAdd.addEventListener("click", () => {
        const value = normalizeTagName(el.eTagInput.value);
        if (!value) {
          return;
        }
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
        if (action !== "save") {
          return;
        }
        event.preventDefault();
        if (!tryAddEditorTag(el.eTagInput.value)) {
          return;
        }
        el.editor.close("save");
      });
    }
    bind();
    return { editBook, renderEditorTags, renderTagDatalist, tryAddEditorTag };
  }

  // frontend/src/files.ts
  function createFiles(deps) {
    const { doc, el } = deps;
    function fileLinkNode(book, item) {
      const link = doc.createElement("a");
      link.className = "file-link";
      link.href = `/api/download?key=${encodeURIComponent(book.key)}&file=${encodeURIComponent(item.file)}`;
      link.download = item.name;
      link.append(
        make(doc, "span", "fmt", item.format),
        make(doc, "span", "f-name", item.name),
        make(doc, "span", "f-meta", bytesLabel(item.size_mb ?? 0)),
        svgIcon(doc, "download")
      );
      return link;
    }
    async function fillFiles(container, book) {
      container.replaceChildren(make(doc, "div", "f-meta", "загружаю…"));
      try {
        const items = await deps.api.get(
          `/api/files?key=${encodeURIComponent(book.key)}`
        );
        container.replaceChildren(
          ...items.length ? items.map((item) => fileLinkNode(book, item)) : [make(doc, "div", "f-meta", "файлов нет")]
        );
      } catch (error) {
        container.replaceChildren(
          make(doc, "div", "f-meta", `не удалось загрузить: ${error.message}`)
        );
      }
    }
    function openFiles(book) {
      el.filesTitle.textContent = book.title || book.key;
      el.files.showModal();
      return fillFiles(el.filesList, book);
    }
    return { openFiles, fillFiles, fileLinkNode };
  }

  // frontend/src/nav.ts
  function createNav(deps) {
    const { doc, el, state } = deps;
    function renderNav() {
      const visible = filterSections(state.sections, el.sectionSearch.value);
      if (!visible.length && el.sectionSearch.value.trim()) {
        el.sections.replaceChildren(make(doc, "div", "empty", "Раздел не найден"));
      } else {
        el.sections.replaceChildren(
          ...visible.map((item) => {
            const button = make(doc, "button");
            button.type = "button";
            button.title = item.name;
            button.append(
              make(doc, "span", "label", item.name),
              make(doc, "span", "count", item.count)
            );
            button.classList.toggle("active", state.section === item.name);
            if (state.section === item.name) {
              button.setAttribute("aria-current", "page");
            }
            button.onclick = () => selectSection(item.name, sectionSort(state.sort));
            return button;
          })
        );
      }
      for (const node of el.sidebar.querySelectorAll(".nav-item[data-view]")) {
        const active = state.section === "*" && node.dataset.view === "recent" === (state.sort === "added");
        node.classList.toggle("active", active);
      }
      el.viewTitle.textContent = viewName(state);
    }
    function selectSection(section, sort) {
      state.section = section;
      state.sort = sort;
      el.sort.value = state.sort;
      deps.closeNavOnMobile();
      renderNav();
      deps.filtersChanged();
    }
    function selectSort(sort) {
      state.sort = sort;
      el.sort.value = sort;
      renderNav();
      deps.filtersChanged();
    }
    function bind() {
      el.sort.addEventListener("change", () => {
        selectSort(el.sort.value);
      });
      el.sectionSearch.addEventListener("input", renderNav);
      el.sectionSearch.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        const first = filterSections(state.sections, el.sectionSearch.value)[0];
        if (first) {
          selectSection(first.name, sectionSort(state.sort));
        }
      });
      for (const node of el.sidebar.querySelectorAll(".nav-item[data-view]")) {
        node.addEventListener("click", () => {
          selectSection("*", node.dataset.view === "recent" ? "added" : "title");
        });
      }
    }
    async function loadSections() {
      const sections = await deps.api.get("/api/sections");
      state.sections = sections;
      el.sectionsList.replaceChildren(
        ...sections.map((item) => {
          const option = doc.createElement("option");
          option.value = item.name;
          return option;
        })
      );
      el.totalCount.textContent = String(sections.reduce((sum, item) => sum + item.count, 0));
      renderNav();
    }
    return { bind, renderNav, selectSection, selectSort, loadSections };
  }

  // frontend/src/rescan.ts
  function createRescan(deps) {
    function bind() {
      deps.el.rescan.addEventListener("click", async () => {
        const label = deps.el.rescan.querySelector(".label-wide");
        deps.el.rescan.disabled = true;
        if (label) label.textContent = "Сканирую…";
        try {
          const result = await deps.api.send("/api/rescan", "POST");
          deps.toast.show(`Добавлено ${result.added}, обновлено ${result.updated}, пропало ${result.missing}, обложек ${result.covers_built} (${result.elapsed} с)`);
          await Promise.all([deps.loadStatus(), deps.loadSections(), deps.loadFormats(), deps.loadBooks()]);
        } catch (error) {
          deps.toast.show(`Скан не выполнен: ${error.message}`, true);
        } finally {
          deps.el.rescan.disabled = false;
          if (label) label.textContent = "Обновить";
        }
      });
    }
    return { bind };
  }

  // frontend/src/settings.ts
  var SOURCE_NAMES = {
    config: "рантайм-конфиг",
    env: "окружение",
    "env-file": "файл .env",
    default: "по умолчанию"
  };
  function createSettings(deps) {
    const { el } = deps;
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
        const data = await deps.api.get(
          `/api/settings/preview?root=${encodeURIComponent(value)}`
        );
        let message = `${data.files} ${plural(data.files, "файл", "файла", "файлов")}: ${data.books} ${plural(data.books, "книжный", "книжных", "книжных")}`;
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
        setPreview(error.message, "error");
      } finally {
        el.sCheck.disabled = false;
      }
    }
    async function openSettings() {
      deps.closeNavOnMobile();
      el.sApply.disabled = true;
      el.sRoot.disabled = true;
      el.sCurrent.textContent = "";
      el.sInfo.textContent = "";
      setPreview("");
      el.settings.showModal();
      try {
        const data = await deps.api.get("/api/settings");
        const source = SOURCE_NAMES[data.root_source] ?? data.root_source;
        el.sCurrent.textContent = `сейчас: ${data.root} (${source})`;
        el.sRoot.value = data.root;
        el.sRoot.disabled = false;
        const missing = Object.entries(data.read_only.tools).filter(([, ok]) => !ok).map(([name]) => name);
        el.sInfo.textContent = missing.length ? `не найдены: ${missing.join(", ")} — обложки могут не генерироваться` : `обложки: ${data.read_only.cover_width}×${data.read_only.cover_max_height}, требуемые утилиты на месте`;
      } catch (error) {
        el.sRoot.disabled = false;
        setPreview(`Не удалось загрузить настройки: ${error.message}`, "error");
      }
    }
    async function applySettings() {
      el.sApply.disabled = true;
      el.sCheck.disabled = true;
      setPreview("Применяю…");
      try {
        const result = await deps.api.send("/api/settings", "POST", {
          root: el.sRoot.value.trim()
        });
        el.settings.close();
        deps.toast.show(
          `Корень сменён: добавлено ${result.added}, обложек ${result.covers_built} (${result.elapsed} с)`
        );
        await Promise.all([
          deps.loadStatus(),
          deps.loadSections(),
          deps.loadFormats(),
          deps.loadBooks()
        ]);
      } catch (error) {
        setPreview(error.message, "error");
      } finally {
        el.sCheck.disabled = false;
      }
    }
    function bind() {
      el.settingsBtn.addEventListener("click", () => {
        void openSettings();
      });
      el.sForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void checkRoot();
      });
      el.sCancel.addEventListener("click", () => el.settings.close());
      el.sApply.addEventListener("click", () => {
        void applySettings();
      });
      el.sRoot.addEventListener("input", () => {
        el.sApply.disabled = true;
        setPreview("");
      });
    }
    return { bind, openSettings, checkRoot, applySettings };
  }

  // frontend/src/status.ts
  function createStatus({ doc, el, state, api }) {
    async function loadStatus() {
      const status = await api.get("/api/status");
      state.local = status.local !== false;
      state.hostDesktop = status.host_desktop === true;
      doc.body.classList.toggle("remote", !state.local);
      const scanned = status.last_scan ? new Date(status.last_scan * 1e3).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—";
      el.status.replaceChildren();
      if (status.mounted) {
        el.status.textContent = `${status.covers} обложек · скан ${scanned}`;
        el.banner.hidden = true;
      } else {
        el.status.append(make(doc, "span", "warn", "библиотека не смонтирована"));
        el.banner.textContent = "Библиотека не смонтирована: каталог показан из кэша, скачивание и открытие файлов недоступны.";
        el.banner.hidden = false;
      }
    }
    return { loadStatus };
  }

  // frontend/src/tag_filter.ts
  function createTagFilter(deps) {
    const { doc, el, state } = deps;
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
        const button = make(doc, "button", "chip", chip.label);
        button.type = "button";
        button.title = "Убрать фильтр";
        button.append(make(doc, "span", "x", "✕"));
        button.onclick = () => {
          removeChip(state, chip);
          deps.filtersChanged();
        };
        return button;
      });
      const reset = make(doc, "button", "chip reset", "Сбросить всё");
      reset.type = "button";
      reset.onclick = deps.onReset;
      el.chips.replaceChildren(...nodes, reset);
    }
    function renderFilterList() {
      const term = el.tfSearch.value.trim().toLowerCase();
      const rows = state.availableTags.filter((tag) => {
        if (!term) {
          return true;
        }
        return tag.name.toLowerCase().includes(term) || tag.aliases.some((alias) => alias.toLowerCase().includes(term));
      });
      if (!rows.length) {
        el.tfList.replaceChildren(
          make(
            doc,
            "div",
            "state",
            state.availableTags.length ? "Ничего не найдено" : "Тегов пока нет"
          )
        );
        return;
      }
      el.tfList.replaceChildren(
        ...rows.map((tag) => {
          const row = make(doc, "label", "check-row");
          const input = doc.createElement("input");
          input.type = "checkbox";
          input.checked = state.tags.includes(tag.name);
          input.onchange = () => {
            if (input.checked) {
              if (!state.tags.includes(tag.name)) {
                state.tags.push(tag.name);
              }
            } else {
              state.tags = state.tags.filter((name) => name !== tag.name);
            }
            renderChips();
            deps.reloadBooks();
          };
          row.append(
            input,
            make(doc, "span", "", `${tag.name} · ${tag.kind}`),
            make(doc, "span", "count", tag.count)
          );
          return row;
        })
      );
    }
    function renderFilterPanel() {
      el.tfFormats.replaceChildren(
        ...state.availableFormats.map((item) => {
          const button = make(doc, "button", "", item.name.toUpperCase());
          button.type = "button";
          button.setAttribute("aria-pressed", String(state.formats.includes(item.name)));
          button.append(make(doc, "span", "count", item.count));
          button.onclick = () => {
            toggleFormat(state, item.name);
            deps.filtersChanged();
          };
          return button;
        })
      );
      renderFilterList();
    }
    function applyTagFilter(name) {
      state.tags = [name];
      deps.filtersChanged();
    }
    function bind() {
      el.filtersBtn.addEventListener("click", () => {
        el.tfSearch.value = "";
        renderFilterPanel();
        el.tagfilter.showModal();
      });
      el.tfSearch.addEventListener("input", renderFilterList);
      el.tfForm.addEventListener("submit", (event) => event.preventDefault());
      el.tfClear.addEventListener("click", () => {
        clearPanelFilters(state);
        deps.filtersChanged();
      });
      el.tfClose.addEventListener("click", () => el.tagfilter.close());
      el.tfDone.addEventListener("click", () => el.tagfilter.close());
    }
    return { bind, renderChips, renderFilterPanel, renderFilterList, applyTagFilter };
  }

  // frontend/src/tags_admin.ts
  function createTagsAdmin(deps) {
    const { doc, el, state } = deps;
    async function runTagAction(action) {
      try {
        await action();
        await deps.loadTags();
      } catch (error) {
        deps.toast.show(`Не сохранилось: ${error.message}`, true);
      }
    }
    function renderAdminList() {
      const term = el.taSearch.value.trim().toLowerCase();
      const tagsToShow = state.availableTags.filter((tag) => {
        if (!term) {
          return true;
        }
        return tag.name.toLowerCase().includes(term) || tag.kind.toLowerCase().includes(term) || tag.aliases.some((alias) => alias.toLowerCase().includes(term));
      });
      el.taList.replaceChildren(
        ...tagsToShow.map((tag) => {
          const button = make(doc, "button", "admin-row", `${tag.name} · ${tag.kind} · ${tag.count}`);
          button.type = "button";
          button.classList.toggle("selected", state.selectedTagId === tag.id);
          button.onclick = () => {
            state.selectedTagId = tag.id;
            el.taName.value = tag.name;
            el.taKind.value = tag.kind;
            el.taDescription.value = tag.description ?? "";
            el.taAlias.value = "";
            el.taMergeTarget.value = "";
            renderAdminList();
          };
          return button;
        })
      );
    }
    function bind() {
      el.tagsAdminBtn.addEventListener("click", () => {
        deps.closeNavOnMobile();
        el.taSearch.value = "";
        renderAdminList();
        el.tagsadmin.showModal();
      });
      el.taSearch.addEventListener("input", renderAdminList);
      el.taClose.addEventListener("click", () => el.tagsadmin.close());
      el.taForm.addEventListener("submit", (event) => event.preventDefault());
      el.taCreate.addEventListener("click", () => {
        const payload = {
          name: el.taName.value,
          kind: el.taKind.value || "custom",
          description: el.taDescription.value
        };
        void runTagAction(() => deps.api.send("/api/tags", "POST", payload));
      });
      el.taSave.addEventListener("click", () => {
        if (state.selectedTagId == null) {
          return;
        }
        const payload = {
          name: el.taName.value,
          kind: el.taKind.value,
          description: el.taDescription.value
        };
        void runTagAction(
          () => deps.api.send(`/api/tags/${state.selectedTagId}`, "PUT", payload)
        );
      });
      el.taAddAlias.addEventListener("click", () => {
        if (state.selectedTagId == null) {
          return;
        }
        void runTagAction(
          () => deps.api.send(`/api/tags/${state.selectedTagId}/aliases`, "POST", {
            alias: el.taAlias.value
          })
        );
      });
      el.taRemoveAlias.addEventListener("click", () => {
        if (state.selectedTagId == null) {
          return;
        }
        void runTagAction(
          () => deps.api.send(
            `/api/tags/${state.selectedTagId}/aliases?alias=${encodeURIComponent(el.taAlias.value)}`,
            "DELETE"
          )
        );
      });
      el.taMerge.addEventListener("click", () => {
        if (state.selectedTagId == null) {
          return;
        }
        const target = state.availableTags.find((item) => item.name === el.taMergeTarget.value);
        if (!target) {
          return;
        }
        const payload = { source: state.selectedTagId, target: target.id };
        void runTagAction(() => deps.api.send("/api/tags/merge", "POST", payload));
      });
      el.taDelete.addEventListener("click", () => {
        if (state.selectedTagId == null) {
          return;
        }
        const tagId = state.selectedTagId;
        void runTagAction(async () => {
          await deps.api.send(`/api/tags/${tagId}`, "DELETE");
          state.selectedTagId = null;
        });
      });
    }
    return { bind, renderAdminList };
  }

  // frontend/src/toast.ts
  var defaultTimers = {
    after: (ms, callback) => setTimeout(callback, ms),
    clear: (timer) => clearTimeout(timer)
  };
  function createToast(el, timers = defaultTimers) {
    let timer = null;
    return {
      show(message, isError = false) {
        el.toast.textContent = message;
        el.toast.classList.toggle("error", isError);
        el.toast.hidden = false;
        if (timer !== null) {
          timers.clear(timer);
        }
        timer = timers.after(4e3, () => {
          el.toast.hidden = true;
          timer = null;
        });
      }
    };
  }

  // frontend/src/app.ts
  function createApp(doc, api, storage2) {
    const el = findElements(doc);
    const state = createState(storage2);
    const toast = createToast(el);
    const closeNavOnMobile = () => doc.body.classList.remove("nav-open");
    function filtersChanged() {
      el.search.value = state.q;
      nav.renderNav();
      filters.renderChips();
      filters.renderFilterPanel();
      void catalog.loadBooks();
    }
    function resetFilters() {
      resetAllFilters(state);
      filtersChanged();
    }
    const files = createFiles({ doc, el, api });
    async function openBook(book) {
      try {
        const result = await api.send("/api/open", "POST", { key: book.key });
        toast.show(`Открыто: ${result.opened || book.title}`);
      } catch (error) {
        toast.show(`Не удалось открыть папку: ${error.message}`, true);
      }
    }
    const cards = createCards({
      doc,
      state,
      openBook,
      openFiles: files.openFiles,
      openDetails: (book) => details.openDetails(book),
      editBook: (book) => editor.editBook(book),
      applyTagFilter: (name) => filters.applyTagFilter(name),
      sortBy: (sort) => nav.selectSort(sort)
    });
    const catalog = createCatalog({ doc, el, state, api, cards, toast, pageSize: 120, onResetFilters: resetFilters });
    const nav = createNav({ doc, el, state, api, filtersChanged, closeNavOnMobile });
    const filters = createTagFilter({
      doc,
      el,
      state,
      filtersChanged,
      reloadBooks: () => {
        void catalog.loadBooks();
      },
      onReset: resetFilters
    });
    const status = createStatus({ doc, el, state, api });
    async function loadTags() {
      state.availableTags = await api.get("/api/tags");
      editor.renderTagDatalist();
      filters.renderChips();
      filters.renderFilterList();
      admin.renderAdminList();
    }
    async function loadFormats() {
      state.availableFormats = await api.get("/api/formats");
      filters.renderFilterPanel();
    }
    const refresh = { loadStatus: status.loadStatus, loadSections: nav.loadSections, loadBooks: catalog.loadBooks, loadFormats };
    const editor = createEditor({ doc, el, state, api, toast, loadTags, ...refresh });
    const details = createDetails({
      doc,
      el,
      state,
      cards,
      openBook,
      editBook: editor.editBook,
      applyTagFilter: filters.applyTagFilter,
      fillFiles: files.fillFiles
    });
    const admin = createTagsAdmin({ doc, el, state, api, toast, loadTags, closeNavOnMobile });
    const settings = createSettings({ doc, el, api, toast, closeNavOnMobile, ...refresh });
    const rescan = createRescan({ el, api, toast, ...refresh });
    function applyView() {
      for (const button of el.viewSwitch.querySelectorAll("button")) {
        button.setAttribute("aria-pressed", String(button.dataset.mode === state.view));
      }
      el.densityBtn.hidden = state.view !== "grid";
      el.densityBtn.setAttribute("aria-pressed", String(state.density === "compact"));
    }
    const currentTheme = () => doc.documentElement.dataset.theme === "light" ? "light" : "dark";
    function applyTheme(theme) {
      doc.documentElement.dataset.theme = theme;
      el.themeBtn.querySelector("use")?.setAttribute("href", theme === "light" ? "#i-moon" : "#i-sun");
      el.themeBtn.title = theme === "light" ? "Тёмная тема" : "Светлая тема";
      el.themeBtn.setAttribute("aria-label", el.themeBtn.title);
      const meta = doc.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = theme === "light" ? "#eeebe3" : "#1c1f25";
    }
    const isMobile = () => window.matchMedia("(max-width: 700px)").matches;
    let searchTimer;
    function bind() {
      nav.bind();
      filters.bind();
      admin.bind();
      settings.bind();
      rescan.bind();
      el.search.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.q = el.search.value.trim();
          filters.renderChips();
          void catalog.loadBooks();
        }, 250);
      });
      el.search.addEventListener("keydown", (event) => {
        if (event.key === "Enter") el.search.blur();
      });
      el.viewSwitch.addEventListener("click", (event) => {
        const button = event.target instanceof Element ? event.target.closest("button[data-mode]") : null;
        const mode = button?.dataset.mode;
        if (mode !== "grid" && mode !== "list" || mode === state.view) return;
        state.view = mode;
        writePref(storage2, "booklib.view", mode);
        applyView();
        catalog.renderCatalog();
      });
      el.densityBtn.addEventListener("click", () => {
        state.density = state.density === "compact" ? "standard" : "compact";
        writePref(storage2, "booklib.density", state.density);
        applyView();
        catalog.renderCatalog();
      });
      el.themeBtn.addEventListener("click", () => {
        const theme = currentTheme() === "light" ? "dark" : "light";
        writePref(storage2, "booklib.theme", theme);
        applyTheme(theme);
      });
      el.moreBtn.addEventListener("click", () => {
        void catalog.loadMoreBooks();
      });
      if ("IntersectionObserver" in window) {
        new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) void catalog.loadMoreBooks();
        }, { rootMargin: "600px 0px" }).observe(el.more);
      }
      el.filesCancel.addEventListener("click", () => el.files.close());
      el.dClose.addEventListener("click", () => el.details.close());
      for (const dialog of [el.files, el.details, el.tagfilter, el.tagsadmin]) {
        dialog.addEventListener("click", (event) => {
          if (event.target === dialog) dialog.close();
        });
      }
      el.burger.addEventListener("click", () => {
        if (isMobile()) {
          doc.body.classList.toggle("nav-open");
          return;
        }
        const collapsed = doc.body.classList.toggle("nav-collapsed");
        writePref(storage2, "booklib.sidebar", collapsed ? "collapsed" : "open");
      });
      doc.getElementById("sidebar-overlay")?.addEventListener("click", closeNavOnMobile);
      doc.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && doc.body.classList.contains("nav-open")) {
          closeNavOnMobile();
          return;
        }
        const target = event.target instanceof Element ? event.target : null;
        if (event.key === "/" && !target?.closest("input, textarea, select, dialog")) {
          event.preventDefault();
          el.search.focus();
        }
      });
    }
    async function start() {
      bind();
      if (readPref(storage2, "booklib.sidebar", ["open", "collapsed"], "open") === "collapsed") doc.body.classList.add("nav-collapsed");
      applyTheme(currentTheme());
      applyView();
      nav.renderNav();
      try {
        await status.loadStatus();
      } catch (error) {
        state.local = false;
        state.hostDesktop = false;
        doc.body.classList.add("remote");
        toast.show(`Не удалось получить статус: ${error.message}`, true);
      }
      const results = await Promise.allSettled([loadTags(), nav.loadSections(), loadFormats(), catalog.loadBooks()]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") toast.show(`Не удалось загрузить каталог: ${failed.reason.message}`, true);
    }
    return { start, state };
  }

  // frontend/src/pwa.ts
  function bindPwa() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((error) => {
          console.warn("serviceWorker registration failed:", error);
        });
      });
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    if (standalone) return;
    const btn = document.getElementById("installBtn");
    if (!btn) return;
    let deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredPrompt = event;
      btn.hidden = false;
    });
    btn.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      void deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.hidden = true;
    });
    window.addEventListener("appinstalled", () => {
      btn.hidden = true;
      deferredPrompt = null;
    });
  }

  // frontend/src/browser.ts
  var storage = null;
  try {
    storage = window.localStorage;
  } catch {
  }
  void createApp(document, createApi(), storage).start();
  bindPwa();
})();
