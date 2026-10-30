import type { ApiClient } from './api';
import { createCards } from './cards';
import { createCatalog } from './catalog';
import { createState, resetAllFilters } from './catalog_state';
import { createDetails } from './details';
import { findElements } from './dom';
import { createEditor } from './editor';
import { createFiles } from './files';
import { createNav } from './nav';
import { createRescan } from './rescan';
import { createSettings } from './settings';
import { createStatus } from './status';
import { createTagFilter } from './tag_filter';
import { createTagsAdmin } from './tags_admin';
import { createToast } from './toast';
import type { BookDto, FormatCountDto, OpenBookResult, TagDto } from './types';
import { readPref, writePref, type PreferenceStorage } from './ui_helpers';

export function createApp(doc: Document, api: ApiClient, storage: PreferenceStorage | null) {
  const el = findElements(doc);
  const state = createState(storage);
  const toast = createToast(el);
  const closeNavOnMobile = () => doc.body.classList.remove('nav-open');
  function filtersChanged(): void {
    el.search.value = state.q;
    nav.renderNav();
    filters.renderChips();
    filters.renderFilterPanel();
    void catalog.loadBooks();
  }
  function resetFilters(): void {
    resetAllFilters(state);
    filtersChanged();
  }
  const files = createFiles({ doc, el, api });
  async function openBook(book: BookDto): Promise<void> {
    try {
      const result = await api.send<OpenBookResult>('/api/open', 'POST', { key: book.key });
      toast.show(`Открыто: ${result.opened || book.title}`);
    } catch (error) {
      toast.show(`Не удалось открыть папку: ${(error as Error).message}`, true);
    }
  }
  const cards = createCards({ doc, state, openBook,
    openFiles: files.openFiles,
    openDetails: (book) => details.openDetails(book),
    editBook: (book) => editor.editBook(book),
    applyTagFilter: (name) => filters.applyTagFilter(name),
    sortBy: (sort) => nav.selectSort(sort),
  });
  const catalog = createCatalog({ doc, el, state, api, cards, toast, pageSize: 120, onResetFilters: resetFilters });
  const nav = createNav({ doc, el, state, api, filtersChanged, closeNavOnMobile });
  const filters = createTagFilter({ doc, el, state, filtersChanged,
    reloadBooks: () => { void catalog.loadBooks(); }, onReset: resetFilters });
  const status = createStatus({ doc, el, state, api });
  async function loadTags(): Promise<void> {
    state.availableTags = await api.get<TagDto[]>('/api/tags');
    editor.renderTagDatalist();
    filters.renderChips();
    filters.renderFilterList();
    admin.renderAdminList();
  }
  async function loadFormats(): Promise<void> {
    state.availableFormats = await api.get<FormatCountDto[]>('/api/formats');
    filters.renderFilterPanel();
  }
  const refresh = { loadStatus: status.loadStatus, loadSections: nav.loadSections, loadBooks: catalog.loadBooks, loadFormats };
  const editor = createEditor({ doc, el, state, api, toast, loadTags, ...refresh });
  const details = createDetails({ doc, el, state, cards, openBook, editBook: editor.editBook,
    applyTagFilter: filters.applyTagFilter, fillFiles: files.fillFiles });
  const admin = createTagsAdmin({ doc, el, state, api, toast, loadTags, closeNavOnMobile });
  const settings = createSettings({ doc, el, api, toast, closeNavOnMobile, ...refresh });
  const rescan = createRescan({ el, api, toast, ...refresh });

  function applyView(): void {
    for (const button of el.viewSwitch.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === state.view));
    }
    el.densityBtn.hidden = state.view !== 'grid';
    el.densityBtn.setAttribute('aria-pressed', String(state.density === 'compact'));
  }
  const currentTheme = () => doc.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  function applyTheme(theme: string): void {
    doc.documentElement.dataset.theme = theme;
    el.themeBtn.querySelector('use')?.setAttribute('href', theme === 'light' ? '#i-moon' : '#i-sun');
    el.themeBtn.title = theme === 'light' ? 'Тёмная тема' : 'Светлая тема';
    el.themeBtn.setAttribute('aria-label', el.themeBtn.title);
    const meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#eeebe3' : '#1c1f25';
  }
  const isMobile = () => window.matchMedia('(max-width: 700px)').matches;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function bind(): void {
    nav.bind(); filters.bind(); admin.bind(); settings.bind(); rescan.bind();
    el.search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.q = el.search.value.trim();
        filters.renderChips();
        void catalog.loadBooks();
      }, 250);
    });
    el.search.addEventListener('keydown', (event) => { if (event.key === 'Enter') el.search.blur(); });
    el.viewSwitch.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-mode]') : null;
      const mode = button?.dataset.mode;
      if ((mode !== 'grid' && mode !== 'list') || mode === state.view) return;
      state.view = mode;
      writePref(storage, 'booklib.view', mode);
      applyView(); catalog.renderCatalog();
    });
    el.densityBtn.addEventListener('click', () => {
      state.density = state.density === 'compact' ? 'standard' : 'compact';
      writePref(storage, 'booklib.density', state.density);
      applyView(); catalog.renderCatalog();
    });
    el.themeBtn.addEventListener('click', () => {
      const theme = currentTheme() === 'light' ? 'dark' : 'light';
      writePref(storage, 'booklib.theme', theme); applyTheme(theme);
    });
    el.moreBtn.addEventListener('click', () => { void catalog.loadMoreBooks(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void catalog.loadMoreBooks();
      }, { rootMargin: '600px 0px' }).observe(el.more);
    }
    el.filesCancel.addEventListener('click', () => el.files.close());
    el.dClose.addEventListener('click', () => el.details.close());
    for (const dialog of [el.files, el.details, el.tagfilter, el.tagsadmin]) {
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    }
    el.burger.addEventListener('click', () => {
      if (isMobile()) { doc.body.classList.toggle('nav-open'); return; }
      const collapsed = doc.body.classList.toggle('nav-collapsed');
      writePref(storage, 'booklib.sidebar', collapsed ? 'collapsed' : 'open');
    });
    doc.getElementById('sidebar-overlay')?.addEventListener('click', closeNavOnMobile);
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && doc.body.classList.contains('nav-open')) { closeNavOnMobile(); return; }
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === '/' && !target?.closest('input, textarea, select, dialog')) {
        event.preventDefault(); el.search.focus();
      }
    });
  }
  async function start(): Promise<void> {
    bind();
    if (readPref(storage, 'booklib.sidebar', ['open', 'collapsed'], 'open') === 'collapsed') doc.body.classList.add('nav-collapsed');
    applyTheme(currentTheme()); applyView(); nav.renderNav();
    try { await status.loadStatus(); }
    catch (error) {
      state.local = false; state.hostDesktop = false; doc.body.classList.add('remote');
      toast.show(`Не удалось получить статус: ${(error as Error).message}`, true);
    }
    const results = await Promise.allSettled([loadTags(), nav.loadSections(), loadFormats(), catalog.loadBooks()]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') toast.show(`Не удалось загрузить каталог: ${(failed.reason as Error).message}`, true);
  }
  return { start, state };
}
