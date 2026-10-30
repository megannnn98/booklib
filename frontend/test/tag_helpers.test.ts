import { describe, expect, it } from "vitest";

import {
  addEditorTagFromInput,
  findAvailableTag,
  normalizeTagName,
  resolveEditorSubmitAction,
} from "../src/tag_helpers";

describe("normalizeTagName", () => {
  it("trims surrounding spaces", () => {
    expect(normalizeTagName("  Платон  ")).toBe("Платон");
  });
});

describe("findAvailableTag", () => {
  it("matches canonical name case-insensitively", () => {
    expect(findAvailableTag([{ name: "Платон", aliases: [], kind: "person" }], "пЛаТоН")).toEqual({
      name: "Платон",
      aliases: [],
      kind: "person",
    });
  });

  it("matches alias case-insensitively", () => {
    expect(
      findAvailableTag([{ name: "Гегель", aliases: ["немецкий идеализм"], kind: "person" }], "НЕМЕЦКИЙ ИДЕАЛИЗМ"),
    ).toEqual({
      name: "Гегель",
      aliases: ["немецкий идеализм"],
      kind: "person",
    });
  });

  it("returns null for unknown tag", () => {
    expect(
      findAvailableTag([{ name: "Платон", aliases: ["платонизм"], kind: "person" }], "Аристотель"),
    ).toBeNull();
  });

  it("returns null for blank input", () => {
    expect(
      findAvailableTag([{ name: "Платон", aliases: ["платонизм"], kind: "person" }], "   "),
    ).toBeNull();
  });
});

describe("addEditorTagFromInput", () => {
  it("appends matching tag and clears input", () => {
    const result = addEditorTagFromInput(
      [{ name: "Платон", aliases: ["платонизм"], kind: "person" }],
      [],
      "ПЛАТОНИЗМ",
    );

    expect(result.added).toBe(true);
    expect(result.inputValue).toBe("");
    expect(result.error).toBeNull();
    expect(result.editorTags).toEqual([{ name: "Платон", aliases: ["платонизм"], kind: "person" }]);
  });

  it("keeps blank input untouched and adds nothing", () => {
    const editorTags = [{ name: "Гегель", aliases: [], kind: "person" }];
    const result = addEditorTagFromInput([], editorTags, "   ");

    expect(result.added).toBe(false);
    expect(result.inputValue).toBe("   ");
    expect(result.error).toBeNull();
    expect(result.editorTags).toBe(editorTags);
  });

  it("rejects unknown tag with explicit error", () => {
    const editorTags = [{ name: "Гегель", aliases: [], kind: "person" }];
    const result = addEditorTagFromInput([], editorTags, "Платон");

    expect(result.added).toBe(false);
    expect(result.inputValue).toBe("Платон");
    expect(result.error).toBe("Нет такого тега: Платон");
    expect(result.editorTags).toBe(editorTags);
  });

  it("drops duplicate and clears stale input", () => {
    const editorTags = [{ name: "Платон", aliases: [], kind: "person" }];
    const result = addEditorTagFromInput(editorTags, editorTags, "платон");

    expect(result.added).toBe(false);
    expect(result.inputValue).toBe("");
    expect(result.error).toBeNull();
    expect(result.editorTags).toBe(editorTags);
  });
});

describe("resolveEditorSubmitAction", () => {
  it("returns null when submitter capability is absent", () => {
    expect(resolveEditorSubmitAction({})).toBeNull();
  });

  it("maps implicit submit to save", () => {
    expect(resolveEditorSubmitAction({ submitter: undefined })).toBe("save");
    expect(resolveEditorSubmitAction({ submitter: null })).toBe("save");
  });

  it("returns clicked button value", () => {
    expect(resolveEditorSubmitAction({ submitter: { value: "cancel" } })).toBe("cancel");
    expect(resolveEditorSubmitAction({ submitter: { value: "reset" } })).toBe("reset");
    expect(resolveEditorSubmitAction({ submitter: { value: "save" } })).toBe("save");
  });
});
