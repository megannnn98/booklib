"use strict";

(function initTagHelpers(globalObject) {
  function normalizeTagName(value) {
    return value.trim();
  }

  function findAvailableTag(availableTags, value) {
    const needle = normalizeTagName(value).toLowerCase();
    if (!needle) return null;
    return (
      availableTags.find((item) =>
        item.name.toLowerCase() === needle
        || (item.aliases || []).some((alias) => alias.toLowerCase() === needle))
      || null
    );
  }

  function addEditorTagFromInput(availableTags, editorTags, value) {
    const normalized = normalizeTagName(value);
    if (!normalized) {
      return {
        added: false,
        editorTags,
        inputValue: value,
        error: null,
      };
    }
    const tag = findAvailableTag(availableTags, normalized);
    if (!tag) {
      return {
        added: false,
        editorTags,
        inputValue: value,
        error: `Нет такого тега: ${normalized}`,
      };
    }
    if (editorTags.some((item) => item.name === tag.name)) {
      return {
        added: false,
        editorTags,
        inputValue: "",
        error: null,
      };
    }
    return {
      added: true,
      editorTags: [...editorTags, tag],
      inputValue: "",
      error: null,
    };
  }

  function resolveEditorSubmitAction(event) {
    if (!("submitter" in event)) {
      return null;
    }
    if (event.submitter == null) {
      return "save";
    }
    return event.submitter.value || null;
  }

  const api = {
    normalizeTagName,
    findAvailableTag,
    addEditorTagFromInput,
    resolveEditorSubmitAction,
  };
  globalObject.BooklibTagHelpers = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
