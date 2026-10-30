import { expect, it } from 'vitest';
import { bindPwa } from '../src/pwa';
import { mountPage } from './helpers/page';

it('offers installation only after a deferred browser prompt and hides it after installation', () => {
  const doc = mountPage();
  bindPwa();
  const prompt = new Event('beforeinstallprompt', { cancelable: true });
  window.dispatchEvent(prompt);
  expect(prompt.defaultPrevented).toBe(true);
  expect(doc.getElementById('installBtn')?.hidden).toBe(false);
  window.dispatchEvent(new Event('appinstalled'));
  expect(doc.getElementById('installBtn')?.hidden).toBe(true);
});
