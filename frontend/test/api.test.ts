import { describe, expect, it, vi } from "vitest";

import { createApi, isPrivilegedRequest } from "../src/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recordingFetch(body: unknown = {}, status = 200) {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const fetchImpl = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return jsonResponse(body, status);
  });
  return { calls, fetchImpl };
}

function headersOf(call: { init?: RequestInit }): Record<string, string> {
  return (call.init?.headers ?? {}) as Record<string, string>;
}

// Инвариант 1: X-Booklib отпускает только запросы к привилегированным ручкам.
// Публичные ручки (каталог, обложки, файлы, скачивание, чтение тегов) обязаны
// обходиться без заголовка, иначе ссылкой нельзя поделиться, а Range-скачивание
// на телефоне ломается на preflight'е.
describe("createApi privileged header", () => {
  it.each([
    ["GET", "/api/status"],
    ["GET", "/api/sections"],
    ["GET", "/api/formats"],
    ["GET", "/api/books?section=*&sort=title&limit=120&offset=0"],
    ["GET", "/api/tags"],
    ["GET", "/api/files?key=a"],
    ["GET", "/api/cover?key=a"],
    ["GET", "/api/download?key=a&file=a.pdf"],
  ])("sends no X-Booklib for public %s %s", async (method, path) => {
    const { calls, fetchImpl } = recordingFetch(method === "GET" ? [] : {});
    const api = createApi(fetchImpl);

    await (method === "GET" ? api.get(path) : api.send(path, method));

    expect(calls).toHaveLength(1);
    expect(headersOf(calls[0]!)).not.toHaveProperty("X-Booklib");
  });

  it.each([
    ["POST", "/api/rescan"],
    ["POST", "/api/open"],
    ["POST", "/api/book"],
    ["PUT", "/api/book/math%2Fkniga/tags"],
    ["GET", "/api/settings"],
    ["GET", "/api/settings/preview?root=%2Ftmp"],
    ["POST", "/api/settings"],
    ["POST", "/api/tags"],
    ["PUT", "/api/tags/3"],
    ["DELETE", "/api/tags/3"],
    ["POST", "/api/tags/3/aliases"],
    ["DELETE", "/api/tags/3/aliases?alias=x"],
    ["POST", "/api/tags/merge"],
  ])("sends X-Booklib for privileged %s %s", async (method, path) => {
    const { calls, fetchImpl } = recordingFetch({});
    const api = createApi(fetchImpl);

    await api.send(path, method);

    expect(calls[0]!.path).toBe(path);
    expect(headersOf(calls[0]!)).toMatchObject({ "X-Booklib": "1" });
  });

  it("treats an unknown api path as privileged (fail closed)", async () => {
    const { calls, fetchImpl } = recordingFetch({});
    await createApi(fetchImpl).send("/api/something-new", "POST");
    expect(headersOf(calls[0]!)).toMatchObject({ "X-Booklib": "1" });
  });

  it("keeps the caller headers alongside the marker", async () => {
    const { calls, fetchImpl } = recordingFetch({});
    await createApi(fetchImpl).send("/api/tags", "POST", { name: "x" }, { Accept: "application/json" });
    expect(headersOf(calls[0]!)).toMatchObject({
      "X-Booklib": "1",
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  });
});

describe("isPrivilegedRequest", () => {
  it("does not privileged-escape a public GET just because of a query string", () => {
    expect(isPrivilegedRequest("GET", "/api/books?q=1")).toBe(false);
    expect(isPrivilegedRequest("GET", "/api/tags")).toBe(false);
  });

  it("keeps a mutating method privileged even on a public path", () => {
    expect(isPrivilegedRequest("POST", "/api/status")).toBe(true);
    expect(isPrivilegedRequest("POST", "/api/tags")).toBe(true);
  });
});

describe("createApi request and errors", () => {
  it("serialises the payload as JSON", async () => {
    const { calls, fetchImpl } = recordingFetch({ action: "saved", key: "a" });
    const result = await createApi(fetchImpl).send("/api/book", "POST", { key: "a", title: "T" });

    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ key: "a", title: "T" }));
    expect(result).toEqual({ action: "saved", key: "a" });
  });

  it("parses a successful JSON body", async () => {
    const { fetchImpl } = recordingFetch({ total: 3, books: [] });
    await expect(createApi(fetchImpl).get("/api/books?section=*")).resolves.toEqual({
      total: 3,
      books: [],
    });
  });

  it("surfaces the api error field", async () => {
    const { fetchImpl } = recordingFetch({ error: "библиотека не смонтирована" }, 503);
    await expect(createApi(fetchImpl).get("/api/books?section=*")).rejects.toThrow(
      "библиотека не смонтирована",
    );
  });

  it("surfaces detail and appends the conflict count", async () => {
    const { fetchImpl } = recordingFetch({ detail: "тег используется", count: 4 }, 409);
    await expect(createApi(fetchImpl).send("/api/tags/1", "DELETE")).rejects.toThrow(
      "тег используется (4)",
    );
  });

  it("surfaces detail without a count", async () => {
    const { fetchImpl } = recordingFetch({ detail: "тег уже есть" }, 409);
    await expect(createApi(fetchImpl).send("/api/tags", "POST", {})).rejects.toThrow("тег уже есть");
  });

  it("falls back to the http status for a non-json error body", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>nope</html>", { status: 502 }));
    await expect(createApi(fetchImpl).get("/api/books?section=*")).rejects.toThrow("HTTP 502");
  });
});
