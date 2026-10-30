import { expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { stubBackend } from './helpers/backend';
import { mountPage } from './helpers/page';
import { makeBook as book } from './helpers/books';

it('starts as a guest after a failed status request and selects downloadable files', async () => {
  const doc = mountPage();
  const backend = stubBackend({ '/api/status': () => { throw new Error('offline'); },
    '/api/books': { total: 1, books: [book()] } });
  const app = createApp(doc, backend.api, null);
  await app.start();
  expect(doc.body.classList.contains('remote')).toBe(true);
  doc.querySelector<HTMLElement>('.card')?.click();
  await vi.waitFor(() => expect(backend.count('GET', `/api/files?key=${encodeURIComponent(book().key)}`)).toBe(1));
  expect(backend.count('POST', '/api/open')).toBe(0);
});

it.each([
  [true, true, '/api/open'],
  [true, false, '/api/files'],
  [false, false, '/api/files'],
])('selects cards after receiving role local=%s host=%s', async (local, host_desktop, endpoint) => {
  const doc = mountPage();
  const backend = stubBackend({
    '/api/status': { local, host_desktop, mounted: true, covers: 0, last_scan: null },
    '/api/books': { total: 1, books: [book()] },
  });
  await createApp(doc, backend.api, null).start();
  doc.querySelector<HTMLElement>('.card')?.click();
  await vi.waitFor(() => expect(backend.find(endpoint === '/api/open' ? 'POST' : 'GET', endpoint)).toBeDefined());
  if (endpoint === '/api/files') expect(backend.find('POST', '/api/open')).toBeUndefined();
  expect(doc.querySelector('.edit') !== null).toBe(local);
});

it('keeps the search field and navigation in sync when removing chips', async () => {
  const doc = mountPage();
  const backend = stubBackend();
  const app = createApp(doc, backend.api, null);
  await app.start();
  const search = doc.querySelector<HTMLInputElement>('#search')!;
  search.value = 'анализ';
  search.dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(app.state.q).toBe('анализ'));
  doc.querySelector<HTMLButtonElement>('.chip')?.click();
  expect(app.state.q).toBe('');
  expect(search.value).toBe('');
});

it('persists view, density and theme choices without reloading the catalogue', async () => {
  const doc = mountPage();
  const backend = stubBackend({ '/api/books': { total: 1, books: [book()] } });
  const store = { getItem: () => null, setItem: vi.fn() };
  await createApp(doc, backend.api, store).start();
  doc.querySelector<HTMLButtonElement>('[data-mode="list"]')?.click();
  expect(doc.querySelector('#grid')?.className).toBe('view-list');
  expect(store.setItem).toHaveBeenCalledWith('booklib.view', 'list');
  doc.querySelector<HTMLButtonElement>('[data-mode="grid"]')?.click();
  doc.querySelector<HTMLButtonElement>('#densityBtn')?.click();
  expect(doc.querySelector('#grid')?.classList.contains('compact')).toBe(true);
  doc.querySelector<HTMLButtonElement>('#themeBtn')?.click();
  expect(doc.documentElement.dataset.theme).toBe('light');
  expect(store.setItem).toHaveBeenCalledWith('booklib.theme', 'light');
  expect(backend.calls.filter((call) => call.path.startsWith('/api/books'))).toHaveLength(1);
});
