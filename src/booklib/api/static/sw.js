"use strict";

// Инвариант: поднимать версию при ЛЮБОМ изменении файлов из STATIC_ASSETS,
// иначе cache-first будет раздавать старую статику навсегда.
const CACHE_VERSION = "booklib-sw-v2";

const STATIC_ASSETS = [
  "/",
  "/static/style.css",
  "/static/app.js",
  "/static/manifest.webmanifest",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/static/icons/icon-maskable-512.png",
];

const OFFLINE_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Booklib недоступен</title>
<style>
*{box-sizing:border-box;margin:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#14161a;color:#dfe3ea;font:16px/1.5 -apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;
text-align:center;padding:24px}
.wrap{max-width:360px}
h1{color:#d8a657;font-size:22px;margin-bottom:12px}
p{color:#8b93a3;margin-bottom:8px}
</style>
</head>
<body>
<div class="wrap">
<h1>Booklib недоступен</h1>
<p>Сервер на компьютере выключен или недоступен в сети.</p>
<p>Запустите <code>booklib.service</code> и обновите страницу.</p>
</div>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("booklib-") && key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.method !== "GET") {
    return;
  }

  if (request.headers.get("Range")) {
    return;
  }

  const dest = request.destination;
  if (dest === "document") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() =>
          caches.match("/").then(
            (cached) =>
              cached ||
              new Response(OFFLINE_HTML, {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              })
          )
        )
    );
    return;
  }

  if (
    dest === "style" ||
    dest === "script" ||
    dest === "manifest" ||
    dest === "image" ||
    url.pathname === "/"
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(request).then((response) => {
          if (response.ok && dest !== "image") {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }
});
