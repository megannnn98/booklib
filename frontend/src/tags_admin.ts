// Словарь тегов: список с поиском и действия create/update/alias/merge/delete.
// Все действия привилегированные — заголовок добавляет api.ts по пути.

import type { ApiClient } from "./api";
import type { CatalogState } from "./catalog_state";
import { make, type Elements } from "./dom";
import type { Toast } from "./toast";
import type {
  CreateTagPayload,
  DeleteTagResult,
  MergeTagsResult,
  MergeTagsPayload,
  TagDto,
  TagMutationResponse,
  UpdateTagPayload,
} from "./types";

export interface TagsAdminDeps {
  doc: Document;
  el: Elements;
  state: CatalogState;
  api: ApiClient;
  toast: Toast;
  loadTags(): Promise<void>;
  closeNavOnMobile(): void;
}

export interface TagsAdmin {
  bind(): void;
  renderAdminList(): void;
}

export function createTagsAdmin(deps: TagsAdminDeps): TagsAdmin {
  const { doc, el, state } = deps;

  async function runTagAction(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      await deps.loadTags();
    } catch (error) {
      deps.toast.show(`Не сохранилось: ${(error as Error).message}`, true);
    }
  }

  function renderAdminList(): void {
    const term = el.taSearch.value.trim().toLowerCase();
    const tagsToShow = state.availableTags.filter((tag) => {
      if (!term) {
        return true;
      }
      return (
        tag.name.toLowerCase().includes(term) ||
        tag.kind.toLowerCase().includes(term) ||
        tag.aliases.some((alias) => alias.toLowerCase().includes(term))
      );
    });

    el.taList.replaceChildren(
      ...tagsToShow.map((tag) => {
        const button = make(doc, "button", "admin-row", `${tag.name} · ${tag.kind} · ${tag.count}`);
        button.type = "button";
        button.classList.toggle("selected", state.selectedTagId === tag.id);
        button.onclick = () => {
          state.selectedTagId = tag.id;
          el.taName.value = tag.name;
          el.taKind.value = tag.kind;
          el.taDescription.value = tag.description ?? "";
          el.taAlias.value = "";
          el.taMergeTarget.value = "";
          renderAdminList();
        };
        return button;
      }),
    );
  }

  function bind(): void {
    el.tagsAdminBtn.addEventListener("click", () => {
      deps.closeNavOnMobile();
      el.taSearch.value = "";
      renderAdminList();
      el.tagsadmin.showModal();
    });
    el.taSearch.addEventListener("input", renderAdminList);
    el.taClose.addEventListener("click", () => el.tagsadmin.close());
    // Форма — только контейнер: без method="dialog" Enter в поле иначе уходит
    // implicit submit'ом в GET на текущий URL и перезагружает витрину.
    el.taForm.addEventListener("submit", (event) => event.preventDefault());

    el.taCreate.addEventListener("click", () => {
      const payload: CreateTagPayload = {
        name: el.taName.value,
        kind: el.taKind.value || "custom",
        description: el.taDescription.value,
      };
      void runTagAction(() => deps.api.send<TagDto>("/api/tags", "POST", payload));
    });

    el.taSave.addEventListener("click", () => {
      if (state.selectedTagId == null) {
        return;
      }
      const payload: UpdateTagPayload = {
        name: el.taName.value,
        kind: el.taKind.value,
        description: el.taDescription.value,
      };
      void runTagAction(() =>
        deps.api.send<TagMutationResponse>(`/api/tags/${state.selectedTagId}`, "PUT", payload),
      );
    });

    el.taAddAlias.addEventListener("click", () => {
      if (state.selectedTagId == null) {
        return;
      }
      void runTagAction(() =>
        deps.api.send<TagMutationResponse>(`/api/tags/${state.selectedTagId}/aliases`, "POST", {
          alias: el.taAlias.value,
        }),
      );
    });

    el.taRemoveAlias.addEventListener("click", () => {
      if (state.selectedTagId == null) {
        return;
      }
      void runTagAction(() =>
        deps.api.send<TagMutationResponse>(
          `/api/tags/${state.selectedTagId}/aliases?alias=${encodeURIComponent(el.taAlias.value)}`,
          "DELETE",
        ),
      );
    });

    el.taMerge.addEventListener("click", () => {
      if (state.selectedTagId == null) {
        return;
      }
      const target = state.availableTags.find((item) => item.name === el.taMergeTarget.value);
      if (!target) {
        return;
      }
      const payload: MergeTagsPayload = { source: state.selectedTagId, target: target.id };
      void runTagAction(() => deps.api.send<MergeTagsResult>("/api/tags/merge", "POST", payload));
    });

    el.taDelete.addEventListener("click", () => {
      if (state.selectedTagId == null) {
        return;
      }
      const tagId = state.selectedTagId;
      void runTagAction(async () => {
        await deps.api.send<DeleteTagResult>(`/api/tags/${tagId}`, "DELETE");
        state.selectedTagId = null;
      });
    });
  }

  return { bind, renderAdminList };
}
