"use strict";

// Статичный макет витрины: выдуманные книги, та же разметка и классы, что
// у src/booklib/api/static/app.js. Обложки рисуются SVG на лету — в репозиторий
// не попадает ни одной настоящей обложки или названия из личной библиотеки.

const BOOKS = [
  { title: "Математический анализ. Том 1", author: "Зорич В. А.", formats: ["djvu", "pdf"], size: "18.4 МБ", section: "Математика", cover: ["portrait", "#1f4e79", "Математический анализ"] },
  { title: "STM32F103xB — Medium-density performance line Arm Cortex-M3 MCU, datasheet rev. 17", author: "", formats: ["pdf"], size: "1.9 МБ", section: "Даташиты и техдокументация", cover: ["datasheet"] },
  { title: "Курс «Цифровая схемотехника», лекция 7: конечные автоматы", author: "", formats: ["pdf"], size: "6.2 МБ", section: "Курсы, лекции и статьи", cover: ["slide", "#283a2e", "Конечные автоматы"], edited: true },
  { title: "Солярис", author: "Лем С.", formats: ["fb2", "epub"], size: "0.6 МБ", section: "Научная фантастика", cover: null },
  { title: "Язык программирования C. Второе издание", author: "Керниган Б., Ритчи Д.", formats: ["pdf", "djvu", "epub"], size: "4.1 МБ", section: "Программирование", cover: ["portrait", "#7a2a2a", "Язык C"] },
  { title: "Феноменология духа", author: "Гегель Г. В. Ф.", formats: ["djvu"], size: "22.7 МБ", section: "Философия и политика", cover: ["portrait", "#3b3247", "Феноменология духа"] },
  { title: "ADS1115 Ultra-Small, Low-Power, I2C-Compatible, 860-SPS, 16-Bit ADC", author: "Texas Instruments", formats: ["pdf"], size: "2.3 МБ", section: "Даташиты и техдокументация", cover: ["datasheet"] },
  { title: "Пивоварение: теория и практика домашнего затора", author: "", formats: ["rtf"], size: "0.2 МБ", section: "Пивоварение", cover: null },
  { title: "Linux Device Drivers, 3rd Edition", author: "Corbet J., Rubini A.", formats: ["pdf", "epub"], size: "7.8 МБ", section: "Linux и системное программирование", cover: ["portrait", "#2b2b2b", "Linux Device Drivers"] },
  { title: "История древнего мира. Восток, Греция, Рим", author: "Ковалёв С. И.", formats: ["djvu"], size: "31.0 МБ", section: "История", cover: ["portrait", "#5a4a22", "История древнего мира"] },
  { title: "Слайды: Attention Is All You Need — разбор статьи", author: "", formats: ["pdf"], size: "3.4 МБ", section: "Machine Learning и LLM", cover: ["slide", "#1d2f4a", "Attention"] },
  { title: "Органическая химия в 4 частях. Часть 2", author: "Реутов О. А.", formats: ["djvu", "pdf"], size: "15.2 МБ", section: "Химия", cover: null, edited: true },
  { title: "Пикник на обочине", author: "Стругацкие А. и Б.", formats: ["fb2"], size: "0.4 МБ", section: "Научная фантастика", cover: ["portrait", "#173c3a", "Пикник на обочине"] },
  { title: "Embedded Rust: от регистра до async-исполнителя", author: "", formats: ["epub"], size: "2.9 МБ", section: "Embedded и микроконтроллеры", cover: ["portrait", "#8a3b12", "Embedded Rust"] },
];

const SECTIONS = [
  ["Математика", 93], ["Даташиты и техдокументация", 41], ["Embedded и микроконтроллеры", 29],
  ["Программирование", 213], ["Linux и системное программирование", 135], ["Machine Learning и LLM", 53],
  ["Философия и политика", 400], ["История", 17], ["Химия", 15], ["Научная фантастика", 144],
  ["Курсы, лекции и статьи", 29], ["Пивоварение", 8], ["Языки", 57], ["Новое", 12],
];

function svgCover(kind, color, text) {
  let body;
  let w = 300;
  let h = 450;
  if (kind === "slide") {
    w = 480; h = 270;
    body = `<rect width="480" height="270" fill="${color}"/><rect x="28" y="28" width="140" height="6" fill="#d8a657"/>`
      + `<text x="28" y="96" font-family="sans-serif" font-size="34" fill="#fff" font-weight="700">${text}</text>`
      + `<rect x="28" y="130" width="300" height="8" rx="4" fill="#ffffff55"/><rect x="28" y="150" width="240" height="8" rx="4" fill="#ffffff55"/>`
      + `<circle cx="400" cy="190" r="44" fill="none" stroke="#d8a657" stroke-width="6"/>`;
  } else if (kind === "datasheet") {
    body = `<rect width="300" height="450" fill="#fff"/><rect x="20" y="22" width="80" height="16" fill="#0b4f9c"/>`
      + `<text x="20" y="72" font-family="sans-serif" font-size="15" font-weight="700" fill="#111">Datasheet</text>`
      + Array.from({ length: 22 }, (_, i) => `<rect x="20" y="${92 + i * 14}" width="${i % 5 === 4 ? 160 : 260}" height="5" fill="#c9ccd1"/>`).join("")
      + `<rect x="170" y="300" width="110" height="80" fill="none" stroke="#999"/><path d="M180 370 L210 330 L240 350 L270 310" stroke="#0b4f9c" stroke-width="3" fill="none"/>`;
  } else {
    body = `<rect width="300" height="450" fill="${color}"/><rect x="0" y="0" width="14" height="450" fill="#00000040"/>`
      + `<rect x="34" y="60" width="232" height="2" fill="#d8a657"/>`
      + `<foreignObject x="34" y="80" width="232" height="240"><div xmlns="http://www.w3.org/1999/xhtml" style="font:700 30px/1.15 sans-serif;color:#fff">${text}</div></foreignObject>`
      + `<rect x="34" y="400" width="80" height="2" fill="#d8a657"/>`;
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;
}

function hue(text) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return hash;
}

function coverHtml(book) {
  if (book.cover) return `<img alt="" src="${svgCover(...book.cover)}">`;
  return `<div class="placeholder" style="--ph-hue:${hue(book.title)}"><div><div class="ph-title">${book.title}</div>`
    + `${book.author ? `<div class="ph-author">${book.author}</div>` : ""}</div><span class="ph-format">${book.formats[0]}</span></div>`;
}

const formatsHtml = (book) => `<div class="formats">${book.formats.map((f) => `<i data-format="${f}">${f}</i>`).join("")}</div>`;
const actionsHtml = `<div class="card-actions"><button class="icon-btn" type="button" aria-label="Подробнее"><svg class="icon"><use href="#i-info"/></svg></button>`
  + `<button class="icon-btn edit" type="button" aria-label="Править"><svg class="icon"><use href="#i-edit"/></svg></button></div>`;

function cardHtml(book) {
  return `<article class="card" tabindex="0" title="${book.title}"><div class="thumb">${coverHtml(book)}${actionsHtml}`
    + `${book.edited ? '<div class="edited">правлено</div>' : ""}</div><div class="card-body"><div class="title">${book.title}</div>`
    + `<div class="meta">${book.author || book.size}</div>${formatsHtml(book)}</div></article>`;
}

function rowHtml(book) {
  return `<article class="row" tabindex="0"><div class="thumb">${coverHtml(book)}</div>`
    + `<div class="c-main"><div class="title">${book.title}${book.edited ? '<span class="edited">правлено</span>' : ""}</div>`
    + `${book.author ? `<div class="sub m-extra">${book.author}</div>` : ""}</div>`
    + `<div class="cell c-author">${book.author || "—"}</div><div class="cell c-section">${book.section}</div>`
    + `<div class="c-formats">${formatsHtml(book)}<span class="m-extra">${book.size}</span></div>`
    + `<div class="cell c-size num">${book.size}</div>${actionsHtml}</article>`;
}

const params = new URLSearchParams(location.search);
const view = params.get("view") || "grid";
document.documentElement.dataset.theme = params.get("theme") || "dark";

document.getElementById("sections").innerHTML = SECTIONS.map(([name, count], i) =>
  `<button type="button" class="${i === 1 ? "active" : ""}"><span class="label">${name}</span><span class="count">${count}</span></button>`).join("");

const grid = document.getElementById("grid");
grid.className = view === "list" ? "view-list" : "view-grid";
for (const button of document.querySelectorAll("#viewSwitch button")) {
  button.setAttribute("aria-pressed", String(button.dataset.mode === view));
}
document.getElementById("densityBtn").hidden = view !== "grid";
grid.innerHTML = view === "list"
  ? `<div class="list-head"><div></div><div><button aria-pressed="true">Название</button></div><div>Автор</div><div>Раздел</div><div>Форматы</div><div class="num"><button>Размер</button></div><div></div></div>`
    + BOOKS.map(rowHtml).join("")
  : BOOKS.map(cardHtml).join("");

if (params.get("details")) {
  const book = BOOKS[0];
  document.getElementById("d-cover").innerHTML = coverHtml(book);
  document.getElementById("details").showModal();
}
