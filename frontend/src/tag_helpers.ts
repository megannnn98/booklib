// Чистые функции редактора тегов: сопоставление введённого текста со словарём
// и разбор submit'а формы. Без DOM — проверяются отдельно от витрины.

export interface TagLike {
  name: string;
  aliases?: readonly string[] | undefined;
}

export interface EditorTagLike extends TagLike {
  id?: number | undefined;
  kind?: string | undefined;
}

export interface AddEditorTagResult<T extends TagLike> {
  added: boolean;
  editorTags: readonly T[];
  inputValue: string;
  error: string | null;
}

/** Событие submit в объёме, который нужен логике: кнопка, отправившая форму. */
export interface SubmitLike {
  submitter?: { value?: string | null } | null | undefined;
}

export function normalizeTagName(value: string): string {
  return value.trim();
}

export function findAvailableTag<T extends TagLike>(
  availableTags: readonly T[],
  value: string,
): T | null {
  const needle = normalizeTagName(value).toLowerCase();
  if (!needle) {
    return null;
  }
  return (
    availableTags.find(
      (item) =>
        item.name.toLowerCase() === needle ||
        (item.aliases ?? []).some((alias) => alias.toLowerCase() === needle),
    ) ?? null
  );
}

export function addEditorTagFromInput<T extends TagLike>(
  availableTags: readonly T[],
  editorTags: readonly EditorTagLike[],
  value: string,
): AddEditorTagResult<EditorTagLike> {
  const normalized = normalizeTagName(value);
  if (!normalized) {
    return { added: false, editorTags, inputValue: value, error: null };
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
    return { added: false, editorTags, inputValue: "", error: null };
  }
  return { added: true, editorTags: [...editorTags, tag], inputValue: "", error: null };
}

export function resolveEditorSubmitAction(event: SubmitLike | object): string | null {
  if (!("submitter" in event)) {
    return null;
  }
  const { submitter } = event as SubmitLike;
  if (submitter == null) {
    return "save";
  }
  return submitter.value || null;
}
