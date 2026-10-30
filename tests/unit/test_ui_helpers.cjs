"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildBooksQuery,
  activeFilters,
  filterSections,
  readPref,
  writePref,
  placeholderHue,
} = require("../../src/booklib/api/static/ui_helpers.js");

const BASE = { section: "*", q: "", sort: "title", tags: [], formats: [] };

test("buildBooksQuery sends only set filters plus paging", () => {
  const query = buildBooksQuery(BASE, 0, 120);
  assert.equal(query, "section=*&sort=title&limit=120&offset=0");
});

test("buildBooksQuery repeats tag and format params", () => {
  const query = new URLSearchParams(buildBooksQuery(
    { section: "Математика", q: "анализ", sort: "added", tags: ["a", "b"], formats: ["pdf", "djvu"] },
    240,
    120,
  ));
  assert.equal(query.get("section"), "Математика");
  assert.equal(query.get("q"), "анализ");
  assert.deepEqual(query.getAll("tag"), ["a", "b"]);
  assert.deepEqual(query.getAll("format"), ["pdf", "djvu"]);
  assert.equal(query.get("offset"), "240");
});

test("activeFilters is empty for the default state", () => {
  assert.deepEqual(activeFilters(BASE), []);
});

test("activeFilters lists section, query, tags and formats in that order", () => {
  const chips = activeFilters({
    ...BASE, section: "Химия", q: "оксид", tags: ["органика"], formats: ["pdf"],
  });
  assert.deepEqual(chips.map((chip) => [chip.kind, chip.value]), [
    ["section", "Химия"],
    ["q", "оксид"],
    ["tag", "органика"],
    ["format", "pdf"],
  ]);
  assert.equal(chips[3].label, "PDF");
});

test("filterSections matches Cyrillic case-insensitively and keeps order", () => {
  const sections = [
    { name: "Математика", count: 93 },
    { name: "Даташиты и техдокументация", count: 41 },
    { name: "История", count: 17 },
  ];
  assert.deepEqual(filterSections(sections, "  МАТ "), [{ name: "Математика", count: 93 }]);
  assert.deepEqual(filterSections(sections, "ист").map((s) => s.name), ["История"]);
  assert.equal(filterSections(sections, "").length, 3);
});

test("readPref falls back on unknown values and on storage errors", () => {
  const storage = new Map([["booklib.view", "table"]]);
  const store = { getItem: (key) => storage.get(key) ?? null, setItem() {} };
  assert.equal(readPref(store, "booklib.view", ["grid", "list"], "grid"), "grid");
  storage.set("booklib.view", "list");
  assert.equal(readPref(store, "booklib.view", ["grid", "list"], "grid"), "list");

  const broken = { getItem() { throw new Error("blocked"); } };
  assert.equal(readPref(broken, "booklib.view", ["grid", "list"], "grid"), "grid");
  assert.equal(readPref(null, "booklib.view", ["grid", "list"], "grid"), "grid");
});

test("writePref swallows storage errors", () => {
  const broken = { setItem() { throw new Error("quota"); } };
  assert.doesNotThrow(() => writePref(broken, "booklib.view", "list"));
});

test("placeholderHue is stable and within the hue circle", () => {
  const hue = placeholderHue("Солярис");
  assert.equal(hue, placeholderHue("Солярис"));
  assert.ok(hue >= 0 && hue < 360);
});
