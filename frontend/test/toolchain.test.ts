import { describe, expect, it } from "vitest";

// Проверяет не бизнес-логику, а сам стенд: без живого DOM и модальных диалогов
// остальные тесты витрины проверяли бы заглушки.
describe("frontend test environment", () => {
  it("mounts markup into a real DOM", () => {
    document.body.innerHTML = '<div id="grid"></div>';
    const grid = document.getElementById("grid");
    expect(grid).toBeInstanceOf(HTMLElement);
  });

  it("implements modal dialog open/close with returnValue", () => {
    document.body.innerHTML = '<dialog id="d"><button value="save">ok</button></dialog>';
    const dialog = document.getElementById("d") as HTMLDialogElement;
    let closed = 0;
    dialog.addEventListener("close", () => {
      closed += 1;
    });

    dialog.showModal();
    expect(dialog.open).toBe(true);

    dialog.close("save");
    expect(dialog.open).toBe(false);
    expect(dialog.returnValue).toBe("save");
    expect(closed).toBe(1);
  });
});
