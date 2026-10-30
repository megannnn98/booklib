import type { ApiClient } from './api';
import type { CatalogState } from './catalog_state';
import { make, type Elements } from './dom';
import type { StatusResponse } from './types';

export function createStatus({ doc, el, state, api }: {
  doc: Document; el: Elements; state: CatalogState; api: ApiClient;
}) {
  async function loadStatus(): Promise<void> {
    const status = await api.get<StatusResponse>('/api/status');
    state.local = status.local !== false;
    state.hostDesktop = status.host_desktop === true;
    doc.body.classList.toggle('remote', !state.local);
    const scanned = status.last_scan
      ? new Date(status.last_scan * 1000).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
      : '—';
    el.status.replaceChildren();
    if (status.mounted) {
      el.status.textContent = `${status.covers} обложек · скан ${scanned}`;
      el.banner.hidden = true;
    } else {
      el.status.append(make(doc, 'span', 'warn', 'библиотека не смонтирована'));
      el.banner.textContent = 'Библиотека не смонтирована: каталог показан из кэша, скачивание и открытие файлов недоступны.';
      el.banner.hidden = false;
    }
  }
  return { loadStatus };
}
