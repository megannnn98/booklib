import { createApi, type ApiClient } from "../../src/api";
import type { RescanResult, RootPreviewResponse, SettingsResponse, StatusResponse } from "../../src/types";

export interface BackendCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

export type BackendHandler = (call: BackendCall) => unknown;
export type BackendRoute = unknown | BackendHandler;

export interface Backend {
  api: ApiClient;
  calls: BackendCall[];
  find(method: string, path: string): BackendCall | undefined;
  count(method: string, path: string): number;
}

export function statusResponse(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return {
    mounted: true,
    local: true,
    host_desktop: true,
    total: 0,
    missing: 0,
    covers: 0,
    last_scan: 1_700_000_000,
    ...overrides,
  };
}

export function settingsResponse(overrides: Partial<SettingsResponse> = {}): SettingsResponse {
  return {
    root: "/mnt/books",
    root_source: "config",
    scan_on_start: false,
    db: "/home/u/.cache/booklib/books.db",
    cover_dir: "/home/u/.cache/booklib/covers",
    mounted: true,
    read_only: {
      host: "127.0.0.1",
      port: 8765,
      cover_width: 400,
      cover_max_height: 600,
      cover_quality: 80,
      render_timeout_s: 30,
      tools: { pdftocairo: true, djvused: true },
    },
    ...overrides,
  };
}

export function previewResponse(overrides: Partial<RootPreviewResponse> = {}): RootPreviewResponse {
  return { root: "/mnt/books", files: 12, books: 10, audio: 2, truncated: false, ...overrides };
}

export function rescanResponse(overrides: Partial<RescanResult> = {}): RescanResult {
  return {
    added: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    restored: 0,
    covers_built: 0,
    covers_failed: 0,
    elapsed: 1.5,
    ...overrides,
  };
}

const DEFAULTS: Record<string, BackendRoute> = {
  "/api/status": statusResponse(),
  "/api/sections": [],
  "/api/tags": [],
  "/api/formats": [],
  "/api/books": { total: 0, books: [] },
  "/api/files": [],
  "/api/settings": settingsResponse(),
  "/api/settings/preview": previewResponse(),
  "/api/rescan": rescanResponse(),
  "/api/open": { opened: "x", dir: "/mnt/books", method: "dbus" },
  "/api/book": (call: BackendCall) => {
    const body = (call.body ?? {}) as { key?: string; reset?: boolean };
    return { action: body.reset ? "reset" : "saved", key: body.key ?? "x" };
  },
};

/**
 * Настоящий createApi поверх подменённого fetch: заголовки и разбор ошибок
 * проверяются тем же кодом, что работает в браузере.
 */
export function stubBackend(routes: Record<string, BackendRoute> = {}): Backend {
  const table = { ...DEFAULTS, ...routes };
  const calls: BackendCall[] = [];

  const api = createApi(async (requestPath, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    const call: BackendCall = {
      method,
      path: requestPath,
      body,
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
    };
    calls.push(call);

    const base = requestPath.split("?")[0] ?? requestPath;
    const route = table[base];
    if (route === undefined) {
      return Response.json({ detail: `нет заглушки для ${method} ${base}` }, { status: 404 });
    }
    if (typeof route === "function") {
      try {
        const value = await Promise.resolve((route as BackendHandler)(call));
        return Response.json(value as unknown);
      } catch (error) {
        return Response.json({ detail: (error as Error).message }, { status: 400 });
      }
    }
    return Response.json(route as unknown);
  });

  return {
    api,
    calls,
    find: (method, requestPath) =>
      calls.find((call) => call.method === method && call.path.startsWith(requestPath)),
    count: (method, requestPath) =>
      calls.filter((call) => call.method === method && call.path.startsWith(requestPath)).length,
  };
}
