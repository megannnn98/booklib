// Сборка витрины: frontend/src/browser.ts → src/booklib/api/static/app.js.
//
// Бандл коммитится в git намеренно: прод запускается uvicorn'ом без Node
// (booklib.service), поэтому собранный файл обязан лежать в пакете. CI
// пересобирает его и падает, если закоммиченный файл разошёлся со сборкой.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "frontend", "src", "browser.ts");
const outfile = path.join(root, "src", "booklib", "api", "static", "app.js");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  charset: "utf8",
  legalComments: "none",
  logLevel: "warning",
});

console.log(`built ${path.relative(root, outfile)}`);
