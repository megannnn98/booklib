import type { Elements } from "./dom";

/** Таймеры вынесены, чтобы тесты не ждали реальные 4 секунды. */
export interface ToastTimers {
  after(ms: number, callback: () => void): number;
  clear(timer: number): void;
}

const defaultTimers: ToastTimers = {
  after: (ms, callback) => setTimeout(callback, ms) as unknown as number,
  clear: (timer) => clearTimeout(timer),
};

export interface Toast {
  show(message: string, isError?: boolean): void;
}

export function createToast(
  el: Pick<Elements, "toast">,
  timers: ToastTimers = defaultTimers,
): Toast {
  let timer: number | null = null;
  return {
    show(message: string, isError = false): void {
      el.toast.textContent = message;
      el.toast.classList.toggle("error", isError);
      el.toast.hidden = false;
      if (timer !== null) {
        timers.clear(timer);
      }
      timer = timers.after(4000, () => {
        el.toast.hidden = true;
        timer = null;
      });
    },
  };
}
