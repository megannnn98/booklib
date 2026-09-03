"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeTagName,
  findAvailableTag,
  addEditorTagFromInput,
  resolveEditorSubmitAction,
} = require("../../src/booklib/api/static/tag_helpers.js");

test("normalizeTagName trims surrounding spaces", () => {
  assert.equal(normalizeTagName("  Платон  "), "Платон");
});

test("findAvailableTag matches canonical name case-insensitively", () => {
  const tag = findAvailableTag(
    [{ name: "Платон", aliases: [], kind: "person" }],
    "пЛаТоН",
  );

  assert.deepEqual(tag, { name: "Платон", aliases: [], kind: "person" });
});

test("findAvailableTag matches alias case-insensitively", () => {
  const tag = findAvailableTag(
    [{ name: "Гегель", aliases: ["немецкий идеализм"], kind: "person" }],
    "НЕМЕЦКИЙ ИДЕАЛИЗМ",
  );

  assert.deepEqual(tag, {
    name: "Гегель",
    aliases: ["немецкий идеализм"],
    kind: "person",
  });
});

test("findAvailableTag returns null for unknown tag", () => {
  const tag = findAvailableTag(
    [{ name: "Платон", aliases: ["платонизм"], kind: "person" }],
    "Аристотель",
  );

  assert.equal(tag, null);
});

test("findAvailableTag returns null for blank input", () => {
  const tag = findAvailableTag(
    [{ name: "Платон", aliases: ["платонизм"], kind: "person" }],
    "   ",
  );

  assert.equal(tag, null);
});

test("addEditorTagFromInput appends matching tag and clears input", () => {
  const result = addEditorTagFromInput(
    [{ name: "Платон", aliases: ["платонизм"], kind: "person" }],
    [],
    "ПЛАТОНИЗМ",
  );

  assert.equal(result.added, true);
  assert.equal(result.inputValue, "");
  assert.equal(result.error, null);
  assert.deepEqual(result.editorTags, [
    { name: "Платон", aliases: ["платонизм"], kind: "person" },
  ]);
});

test("addEditorTagFromInput keeps blank input untouched and adds nothing", () => {
  const editorTags = [{ name: "Гегель", aliases: [], kind: "person" }];
  const result = addEditorTagFromInput([], editorTags, "   ");

  assert.equal(result.added, false);
  assert.equal(result.inputValue, "   ");
  assert.equal(result.error, null);
  assert.strictEqual(result.editorTags, editorTags);
});

test("addEditorTagFromInput rejects unknown tag with explicit error", () => {
  const editorTags = [{ name: "Гегель", aliases: [], kind: "person" }];
  const result = addEditorTagFromInput([], editorTags, "Платон");

  assert.equal(result.added, false);
  assert.equal(result.inputValue, "Платон");
  assert.equal(result.error, "Нет такого тега: Платон");
  assert.strictEqual(result.editorTags, editorTags);
});

test("addEditorTagFromInput drops duplicate and clears stale input", () => {
  const editorTags = [{ name: "Платон", aliases: [], kind: "person" }];
  const result = addEditorTagFromInput(editorTags, editorTags, "платон");

  assert.equal(result.added, false);
  assert.equal(result.inputValue, "");
  assert.equal(result.error, null);
  assert.strictEqual(result.editorTags, editorTags);
});

test("resolveEditorSubmitAction returns null when submitter capability is absent", () => {
  assert.equal(resolveEditorSubmitAction({}), null);
});

test("resolveEditorSubmitAction maps implicit submit to save", () => {
  assert.equal(resolveEditorSubmitAction({ submitter: undefined }), "save");
  assert.equal(resolveEditorSubmitAction({ submitter: null }), "save");
});

test("resolveEditorSubmitAction returns clicked button value", () => {
  assert.equal(resolveEditorSubmitAction({ submitter: { value: "cancel" } }), "cancel");
  assert.equal(resolveEditorSubmitAction({ submitter: { value: "reset" } }), "reset");
  assert.equal(resolveEditorSubmitAction({ submitter: { value: "save" } }), "save");
});
