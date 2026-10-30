import type { BookDto, BookTagDto, FileEntryDto, TagDto } from "../../src/types";

export function makeBook(overrides: Partial<BookDto> = {}): BookDto {
  return {
    key: "math/Анализ",
    title: "Анализ",
    author: "Фихтенгольц",
    year: 1948,
    section: "Математика",
    formats: ["pdf"],
    size_mb: 12.5,
    has_cover: true,
    kind: "book",
    dir: "math",
    edited: false,
    tags: [],
    ...overrides,
  };
}

export function makeTag(overrides: Partial<TagDto> = {}): TagDto {
  return {
    id: 1,
    name: "Платон",
    kind: "person",
    description: null,
    created_at: 0,
    aliases: [],
    count: 0,
    ...overrides,
  };
}

export function makeBookTag(overrides: Partial<BookTagDto> = {}): BookTagDto {
  return { id: 1, name: "Платон", kind: "person", ...overrides };
}

export function makeFile(overrides: Partial<FileEntryDto> = {}): FileEntryDto {
  return { file: "math/Анализ.pdf", name: "Анализ.pdf", format: "pdf", size_mb: 12.5, ...overrides };
}
