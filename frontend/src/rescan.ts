import type { ApiClient } from './api';
import type { Elements } from './dom';
import type { Toast } from './toast';
import type { RescanResult } from './types';

export function createRescan(deps: {
  el: Elements; api: ApiClient; toast: Toast;
  loadStatus(): Promise<void>; loadSections(): Promise<void>;
  loadFormats(): Promise<void>; loadBooks(): Promise<void>;
}) {
  function bind(): void {
    deps.el.rescan.addEventListener('click', async () => {
      const label = deps.el.rescan.querySelector('.label-wide');
      deps.el.rescan.disabled = true;
      if (label) label.textContent = 'Сканирую…';
      try {
        const result = await deps.api.send<RescanResult>('/api/rescan', 'POST');
        deps.toast.show(`Добавлено ${result.added}, обновлено ${result.updated}, пропало ${result.missing}, обложек ${result.covers_built} (${result.elapsed} с)`);
        await Promise.all([deps.loadStatus(), deps.loadSections(), deps.loadFormats(), deps.loadBooks()]);
      } catch (error) {
        deps.toast.show(`Скан не выполнен: ${(error as Error).message}`, true);
      } finally {
        deps.el.rescan.disabled = false;
        if (label) label.textContent = 'Обновить';
      }
    });
  }
  return { bind };
}
