// HTTP-клиент витрины. Правило X-Booklib живёт здесь, а не на местах вызова:
// забыть заголовок нельзя (все неопознанные пути считаются привилегированными),
// а публичные ручки получают его только если явно перечислены в PUBLIC_GET.

import type { ApiErrorBody } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  send<T>(
    path: string,
    method: string,
    payload?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T>;
}

// Read-only ручки, доступные без X-Booklib. Список закрытый: всё, чего в нём
// нет, уходит с заголовком. Это и есть fail-closed для новых путей.
const PUBLIC_GET: readonly RegExp[] = [
  /^\/api\/status$/,
  /^\/api\/sections$/,
  /^\/api\/formats$/,
  /^\/api\/books(?:\?|$)/,
  /^\/api\/cover(?:\?|$)/,
  /^\/api\/files(?:\?|$)/,
  /^\/api\/download(?:\?|$)/,
  /^\/api\/tags$/,
];

export function isPrivilegedRequest(method: string, path: string): boolean {
  if (method.toUpperCase() !== "GET") {
    return true;
  }
  return !PUBLIC_GET.some((pattern) => pattern.test(path));
}

async function errorMessage(response: Response): Promise<string> {
  let detail = `HTTP ${response.status}`;
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === "object" && parsed !== null) {
      const body = parsed as ApiErrorBody;
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
    /* тело не json — оставляем код */
  }
  return detail;
}

export function createApi(
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): ApiClient {
  async function request<T>(
    path: string,
    method: string,
    payload?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (isPrivilegedRequest(method, path)) {
      headers["X-Booklib"] = "1";
    }
    const init: RequestInit = { method, headers };
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(payload);
    }

    const response = await fetchImpl(path, init);
    if (!response.ok) {
      throw new Error(await errorMessage(response));
    }
    // Форма ответа зафиксирована в types.ts и проверена тестами DTO; здесь
    // остаётся только сопоставить её с типом вызывающего кода.
    return (await response.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>(path, "GET"),
    send: <T>(path: string, method: string, payload?: unknown, extraHeaders?: Record<string, string>) =>
      request<T>(path, method, payload, extraHeaders),
  };
}
