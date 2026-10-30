import { readFileSync } from "node:fs";
import path from "node:path";

const INDEX_HTML = path.resolve(process.cwd(), "src/booklib/api/static/index.html");

/**
 * Монтирует настоящую разметку витрины в jsdom: тесты должны падать, если
 * id в index.html разошёлся с кодом, а не проверять выдуманный слепок.
 */
export function mountPage(): Document {
  const html = readFileSync(INDEX_HTML, "utf8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.head.innerHTML = '<meta name="theme-color" content="#1c1f25">';
  document.body.innerHTML = parsed.body.innerHTML;
  document.body.className = "";
  document.documentElement.dataset.theme = "dark";
  return document;
}

/** Подменяет ширину экрана для проверок мобильной раскладки. */
export function setViewport(isMobile: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: isMobile && query.includes("700px"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
