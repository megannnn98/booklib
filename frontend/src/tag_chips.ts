import { make } from "./dom";

/** Минимум, который нужен чипу тега: имя и (в карточке) вид. */
export interface TagChipItem {
  name: string;
  kind?: string | undefined;
}

export interface TagChipHandlers<T extends TagChipItem> {
  onRemove?: ((item: T) => void) | null;
  onClick?: ((item: T) => void) | null;
}

/**
 * Чипы тегов. Без onRemove рисуется только название (клик по карточке),
 * с onRemove — крестик (редактор карточки).
 */
export function renderTagChips<T extends TagChipItem>(
  doc: Document,
  container: HTMLElement,
  items: readonly T[],
  handlers: TagChipHandlers<T>,
): void {
  container.replaceChildren(
    ...items.map((item) => {
      const chip = make(doc, "button", "tag-chip", item.name);
      chip.type = "button";
      if (item.kind) {
        chip.dataset.kind = item.kind;
      }
      if (handlers.onClick) {
        const onClick = handlers.onClick;
        chip.onclick = (event) => {
          event.stopPropagation();
          onClick(item);
        };
      }
      if (handlers.onRemove) {
        const onRemove = handlers.onRemove;
        const remove = make(doc, "span", "tag-x", "✕");
        remove.onclick = (event) => {
          event.stopPropagation();
          onRemove(item);
        };
        chip.append(remove);
      }
      return chip;
    }),
  );
}
