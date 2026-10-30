import { describe, expect, it } from "vitest";

import {
  activeFilters,
  buildBooksQuery,
  filterSections,
  placeholderHue,
  readPref,
  writePref,
} from "../src/ui_helpers";

const BASE = { section: "*", q: "", sort: "title", tags: [], formats: [] };

describe("buildBooksQuery", () => {
  it("sends only set filters plus paging", () => {
    expect(buildBooksQuery(BASE, 0, 120)).toBe("section=*&sort=title&limit=120&offset=0");
  });

  it("repeats tag and format params", () => {
    const query = new URLSearchParams(
      buildBooksQuery(
        { section: "Математика", q: "анализ", sort: "added", tags: ["a", "b"], formats: ["pdf", "djvu"] },
        240,
        120,
      ),
    );
    expect(query.get("section")).toBe("Математика");
    expect(query.get("q")).toBe("анализ");
    expect(query.getAll("tag")).toEqual(["a", "b"]);
    expect(query.getAll("format")).toEqual(["pdf", "djvu"]);
    expect(query.get("offset")).toBe("240");
  });

  it("keeps a fixed parameter order", () => {
    expect(
      buildBooksQuery({ section: "Химия", q: "оксид", sort: "size", tags: ["a"], formats: ["pdf"] }, 60, 120),
    ).toBe("section=%D0%A5%D0%B8%D0%BC%D0%B8%D1%8F&sort=size&q=%D0%BE%D0%BA%D1%81%D0%B8%D0%B4&tag=a&format=pdf&limit=120&offset=60");
  });

  it("leaves the wildcard section unescaped", () => {
    expect(buildBooksQuery(BASE, 0, 120)).not.toContain("%2A");
  });
});

describe("activeFilters", () => {
  it("is empty for the default state", () => {
    expect(activeFilters(BASE)).toEqual([]);
  });

  it("lists section, query, tags and formats in that order", () => {
    const chips = activeFilters({
      ...BASE,
      section: "Химия",
      q: "оксид",
      tags: ["органика"],
      formats: ["pdf"],
    });
    expect(chips.map((chip) => [chip.kind, chip.value])).toEqual([
      ["section", "Химия"],
      ["q", "оксид"],
      ["tag", "органика"],
      ["format", "pdf"],
    ]);
    expect(chips[3]?.label).toBe("PDF");
  });
});

describe("filterSections", () => {
  it("matches Cyrillic case-insensitively and keeps order", () => {
    const sections = [
      { name: "Математика", count: 93 },
      { name: "Даташиты и техдокументация", count: 41 },
      { name: "История", count: 17 },
    ];
    expect(filterSections(sections, "  МАТ ")).toEqual([{ name: "Математика", count: 93 }]);
    expect(filterSections(sections, "ист").map((item) => item.name)).toEqual(["История"]);
    expect(filterSections(sections, "")).toHaveLength(3);
  });
});

describe("readPref", () => {
  it("falls back on unknown values and on storage errors", () => {
    const storage = new Map([["booklib.view", "table"]]);
    const store = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: () => {},
    };
    expect(readPref(store, "booklib.view", ["grid", "list"], "grid")).toBe("grid");
    storage.set("booklib.view", "list");
    expect(readPref(store, "booklib.view", ["grid", "list"], "grid")).toBe("list");

    const broken = {
      getItem() {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(readPref(broken, "booklib.view", ["grid", "list"], "grid")).toBe("grid");
    expect(readPref(null, "booklib.view", ["grid", "list"], "grid")).toBe("grid");
  });
});

describe("writePref", () => {
  it("swallows storage errors", () => {
    const broken = {
      getItem: () => null,
      setItem() {
        throw new Error("quota");
      },
    };
    expect(() => writePref(broken, "booklib.view", "list")).not.toThrow();
  });
});

describe("placeholderHue", () => {
  it("is stable and within the hue circle", () => {
    const hue = placeholderHue("Солярис");
    expect(hue).toBe(placeholderHue("Солярис"));
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
});
