// Общие помощники для DOM-модулей витрины.
//
// Элементы ищутся один раз по id из index.html: опечатка в разметке должна
// падать сразу на старте с понятным сообщением, а не превращаться в тихий null
// посреди отрисовки.

export interface Elements {
  sidebar: HTMLElement;
  sections: HTMLElement;
  sectionSearch: HTMLInputElement;
  totalCount: HTMLElement;
  status: HTMLElement;
  grid: HTMLElement;
  counter: HTMLElement;
  viewTitle: HTMLElement;
  chips: HTMLElement;
  banner: HTMLElement;
  more: HTMLElement;
  moreBtn: HTMLButtonElement;
  search: HTMLInputElement;
  sort: HTMLSelectElement;
  rescan: HTMLButtonElement;
  settingsBtn: HTMLButtonElement;
  filtersBtn: HTMLButtonElement;
  filtersBadge: HTMLElement;
  viewSwitch: HTMLElement;
  densityBtn: HTMLButtonElement;
  themeBtn: HTMLButtonElement;
  tagsAdminBtn: HTMLButtonElement;
  burger: HTMLButtonElement;
  installBtn: HTMLButtonElement;
  sidebarOverlay: HTMLElement | null;
  tagfilter: HTMLDialogElement;
  tfForm: HTMLFormElement;
  tfFormats: HTMLElement;
  tfSearch: HTMLInputElement;
  tfList: HTMLElement;
  tfClear: HTMLButtonElement;
  tfClose: HTMLButtonElement;
  tfDone: HTMLButtonElement;
  tagsadmin: HTMLDialogElement;
  taForm: HTMLFormElement;
  taSearch: HTMLInputElement;
  taList: HTMLElement;
  taName: HTMLInputElement;
  taKind: HTMLSelectElement;
  taDescription: HTMLTextAreaElement;
  taAlias: HTMLInputElement;
  taMergeTarget: HTMLInputElement;
  taCreate: HTMLButtonElement;
  taSave: HTMLButtonElement;
  taAddAlias: HTMLButtonElement;
  taRemoveAlias: HTMLButtonElement;
  taMerge: HTMLButtonElement;
  taDelete: HTMLButtonElement;
  taClose: HTMLButtonElement;
  settings: HTMLDialogElement;
  sCurrent: HTMLElement;
  sForm: HTMLFormElement;
  sRoot: HTMLInputElement;
  sCheck: HTMLButtonElement;
  sCancel: HTMLButtonElement;
  sPreview: HTMLElement;
  sInfo: HTMLElement;
  sApply: HTMLButtonElement;
  files: HTMLDialogElement;
  filesTitle: HTMLElement;
  filesList: HTMLElement;
  filesCancel: HTMLButtonElement;
  details: HTMLDialogElement;
  dClose: HTMLButtonElement;
  dCover: HTMLElement;
  dTitle: HTMLElement;
  dAuthor: HTMLElement;
  dProps: HTMLElement;
  dActions: HTMLElement;
  dFiles: HTMLElement;
  toast: HTMLElement;
  editor: HTMLDialogElement;
  eForm: HTMLFormElement;
  eKey: HTMLElement;
  eTitle: HTMLInputElement;
  eAuthor: HTMLInputElement;
  eSection: HTMLInputElement;
  eTags: HTMLElement;
  eTagInput: HTMLInputElement;
  eTagAdd: HTMLButtonElement;
  eSave: HTMLButtonElement;
  tagsList: HTMLElement;
  sectionsList: HTMLElement;
}

function need<T extends HTMLElement>(doc: Document, id: string): T {
  const node = doc.getElementById(id);
  if (!node) {
    throw new Error(`booklib: в разметке нет элемента #${id}`);
  }
  return node as T;
}

export function findElements(doc: Document): Elements {
  return {
    sidebar: need(doc, "sidebar"),
    sections: need(doc, "sections"),
    sectionSearch: need(doc, "sectionSearch"),
    totalCount: need(doc, "totalCount"),
    status: need(doc, "status"),
    grid: need(doc, "grid"),
    counter: need(doc, "counter"),
    viewTitle: need(doc, "viewTitle"),
    chips: need(doc, "chips"),
    banner: need(doc, "banner"),
    more: need(doc, "more"),
    moreBtn: need(doc, "moreBtn"),
    search: need(doc, "search"),
    sort: need(doc, "sort"),
    rescan: need(doc, "rescan"),
    settingsBtn: need(doc, "settingsBtn"),
    filtersBtn: need(doc, "filtersBtn"),
    filtersBadge: need(doc, "filtersBadge"),
    viewSwitch: need(doc, "viewSwitch"),
    densityBtn: need(doc, "densityBtn"),
    themeBtn: need(doc, "themeBtn"),
    tagsAdminBtn: need(doc, "tagsAdminBtn"),
    burger: need(doc, "burger"),
    installBtn: need(doc, "installBtn"),
    sidebarOverlay: doc.getElementById("sidebar-overlay"),
    tagfilter: need(doc, "tagfilter"),
    tfForm: need(doc, "tf-form"),
    tfFormats: need(doc, "tf-formats"),
    tfSearch: need(doc, "tf-search"),
    tfList: need(doc, "tf-list"),
    tfClear: need(doc, "tf-clear"),
    tfClose: need(doc, "tf-close"),
    tfDone: need(doc, "tf-done"),
    tagsadmin: need(doc, "tagsadmin"),
    taForm: need(doc, "ta-form"),
    taSearch: need(doc, "ta-search"),
    taList: need(doc, "ta-list"),
    taName: need(doc, "ta-name"),
    taKind: need(doc, "ta-kind"),
    taDescription: need(doc, "ta-description"),
    taAlias: need(doc, "ta-alias"),
    taMergeTarget: need(doc, "ta-merge-target"),
    taCreate: need(doc, "ta-create"),
    taSave: need(doc, "ta-save"),
    taAddAlias: need(doc, "ta-add-alias"),
    taRemoveAlias: need(doc, "ta-remove-alias"),
    taMerge: need(doc, "ta-merge"),
    taDelete: need(doc, "ta-delete"),
    taClose: need(doc, "ta-close"),
    settings: need(doc, "settings"),
    sCurrent: need(doc, "s-current"),
    sForm: need(doc, "s-form"),
    sRoot: need(doc, "s-root"),
    sCheck: need(doc, "s-check"),
    sCancel: need(doc, "s-cancel"),
    sPreview: need(doc, "s-preview"),
    sInfo: need(doc, "s-info"),
    sApply: need(doc, "s-apply"),
    files: need(doc, "files"),
    filesTitle: need(doc, "files-title"),
    filesList: need(doc, "files-list"),
    filesCancel: need(doc, "files-cancel"),
    details: need(doc, "details"),
    dClose: need(doc, "d-close"),
    dCover: need(doc, "d-cover"),
    dTitle: need(doc, "d-title"),
    dAuthor: need(doc, "d-author"),
    dProps: need(doc, "d-props"),
    dActions: need(doc, "d-actions"),
    dFiles: need(doc, "d-files"),
    toast: need(doc, "toast"),
    editor: need(doc, "editor"),
    eForm: need(doc, "e-form"),
    eKey: need(doc, "e-key"),
    eTitle: need(doc, "e-title"),
    eAuthor: need(doc, "e-author"),
    eSection: need(doc, "e-section"),
    eTags: need(doc, "e-tags"),
    eTagInput: need(doc, "e-tag-input"),
    eTagAdd: need(doc, "e-tag-add"),
    eSave: need(doc, "e-save"),
    tagsList: need(doc, "tags-list"),
    sectionsList: need(doc, "sections-list"),
  };
}

export function make<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string | number | null,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined && text !== null) {
    node.textContent = String(text);
  }
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svgIcon(doc: Document, name: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = doc.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}
