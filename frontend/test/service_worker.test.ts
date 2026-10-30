import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

interface WorkerEvent {
  request?: Request;
  waitUntil(work: Promise<unknown>): void;
  respondWith(work: Promise<Response>): void;
}

function worker() {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const addAll = vi.fn(async (_urls: string[]) => {});
  const cacheDelete = vi.fn(async (_key: string) => true);
  const self = {
    location: { origin: 'https://books.example' },
    addEventListener: (name: string, callback: (event: WorkerEvent) => void) => handlers.set(name, callback),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  const caches = {
    open: vi.fn(async (_name: string) => ({ addAll })),
    keys: vi.fn(async () => ['booklib-sw-v8', 'booklib-sw-v9', 'other-app']),
    delete: cacheDelete,
  };
  runInNewContext(readFileSync('src/booklib/api/static/sw.js', 'utf8'), { self, caches, URL, Response });
  return { handlers, addAll, cacheDelete, caches };
}

it('installs v9 with the bundled app and only assets present in the Python package', async () => {
  const { handlers, caches, addAll } = worker();
  let pending: Promise<unknown> | undefined;
  handlers.get('install')?.({ waitUntil: (work) => { pending = work; }, respondWith: vi.fn() });
  await pending;
  expect(caches.open).toHaveBeenCalledWith('booklib-sw-v9');
  const urls = addAll.mock.calls[0]?.[0] ?? [];
  expect(urls).toContain('/static/app.js');
  expect(urls).not.toContain('/static/ui_helpers.js');
  expect(urls).not.toContain('/static/tag_helpers.js');
  for (const url of urls) {
    const relative = url === '/' ? 'index.html' : url.replace('/static/', '');
    expect(existsSync(path.join('src/booklib/api/static', relative))).toBe(true);
  }
});

it('removes obsolete booklib caches while keeping the active version and other apps', async () => {
  const { handlers, cacheDelete } = worker();
  let pending: Promise<unknown> | undefined;
  handlers.get('activate')?.({ waitUntil: (work) => { pending = work; }, respondWith: vi.fn() });
  await pending;
  expect(cacheDelete.mock.calls).toEqual([['booklib-sw-v8']]);
});

it.each([
  new Request('https://books.example/api/files?key=a'),
  new Request('https://books.example/api/download?key=a&file=a.pdf'),
  new Request('https://books.example/static/app.js', { headers: { Range: 'bytes=0-5' } }),
])('leaves API and Range requests to the network: %s', (request) => {
  const { handlers } = worker();
  const respondWith = vi.fn();
  handlers.get('fetch')?.({ request, waitUntil: vi.fn(), respondWith });
  expect(respondWith).not.toHaveBeenCalled();
});
