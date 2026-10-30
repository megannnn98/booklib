// Полифиллы для jsdom: браузерные API, которых в нём нет, но на которые
// опирается витрина. Тесты должны проверять нашу логику, а не заглушки jsdom.

/**
 * jsdom объявляет HTMLDialogElement, но не реализует show/showModal/close.
 * Диалоги витрины работают на нативном API, включая returnValue и событие
 * close, поэтому заглушка повторяет именно эту семантику.
 */
function patchDialogs(): void {
  const proto = window.HTMLDialogElement?.prototype;
  if (!proto || typeof proto.showModal === "function") {
    return;
  }
  proto.show = function show(this: HTMLDialogElement): void {
    this.open = true;
  };
  proto.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  proto.close = function close(this: HTMLDialogElement, value?: string): void {
    this.open = false;
    if (value !== undefined) {
      this.returnValue = value;
    }
    this.dispatchEvent(new Event("close"));
  };
}

/**
 * jsdom не реализует matchMedia: витрина спрашивает его для темы, мобильной
 * разметки и display-mode. Умолчание — «ничего не совпало» (десктоп).
 */
function patchMatchMedia(): void {
  if (typeof window.matchMedia === "function") {
    return;
  }
  window.matchMedia = (query: string): MediaQueryList => {
    const list: MediaQueryList = {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
    return list;
  };
}

patchDialogs();
patchMatchMedia();
