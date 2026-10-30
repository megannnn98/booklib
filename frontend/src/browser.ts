import { createApi } from './api';
import { createApp } from './app';
import { bindPwa } from './pwa';
import type { PreferenceStorage } from './ui_helpers';

let storage: PreferenceStorage | null = null;
try { storage = window.localStorage; } catch { /* Приватный режим — без памяти вида. */ }
void createApp(document, createApi(), storage).start();
bindPwa();
