import { $, el, button } from './ui.mjs';
import { catalog } from './catalog.mjs';
import { canAdd, normalize, status } from './rules.mjs';
import { connect } from './cloud.mjs?v=4';
import { spanishImageBackups } from './spanish-image-backups.mjs?v=2';

const navigation = [...document.querySelectorAll('nav a')];
const routes = navigation.map(link => link.getAttribute('href'));
const adminPage = $('administracion');
const isAdminPath = window.location.pathname === '/admin';
const pages = [...routes.map(route => $(route.slice(1))), adminPage];
let activePage;

function showPage() {
  const index = routes.indexOf(window.location.hash);
  const current = isAdminPath ? pages.indexOf(adminPage) : Math.max(0, index);
  if (current === activePage) return;
  if ($('card-detail').open) $('card-detail').close();
  if (activePage !== undefined) {
    pages[current].dataset.slide = current > activePage ? 'forward' : 'backward';
  }
  activePage = current;
  pages.forEach((page, i) => { page.hidden = i !== current; });
  const builderHome = pages[current].id === 'administracion' && $('admin-builder')
    || $('public-builder');
  builderHome.append($('deck-builder'));
  navigation.forEach((link, i) => {
    if (i === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  window.scrollTo({top: 0, behavior: 'auto'});
}

window.addEventListener('hashchange', showPage);
showPage();
if (isAdminPath) {
  for (const link of document.querySelectorAll('.top a[href^="#"]')) {
    link.setAttribute('href', '/' + link.getAttribute('href'));
  }
}

let cards = new Map();
let ready = false;
let isPocket = () => false;
let deck = {};
let limit = 24;
let printing = false;
let detailCardId;
let basicWaterId;
function cleanDeck(candidate) {
  return Object.fromEntries(Object.entries(candidate ?? {}).filter(([id, n]) =>
    /^[a-z0-9.-]+$/i.test(id) && Number.isInteger(n) && n > 0 && n <= 60 && !isPocket(id)));
}

function usesImage(source, url) {
  return source && (url === source || url.startsWith(source + '/'));
}

function needsEnglishImageNotice(card, url) {
  return card.spanish && !card.spanishImages.some(source => usesImage(source, url));
}

function imageOptions(card, quality) {
  return [...new Set([...(card.spanishImages ?? []), card.image, card.alternateImage].filter(Boolean).flatMap(image =>
    /\.(jpg|png|webp|svg)$/i.test(image) ? [image] : [
      image + '/' + quality + '.webp',
      image + '/' + quality + '.png'
    ]))];
}

function setCardImage(image, card, quality, unavailable) {
  const options = imageOptions(card, quality);
  const attempt = () => {
    const next = options.shift();
    if (next) image.src = next;
    else {
      image.onerror = null;
      unavailable();
    }
  };
  image.onerror = attempt;
  attempt();
}

try {
  const saved = JSON.parse(localStorage.getItem('epic-deck'));
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    deck = cleanDeck(saved);
  }
} catch { /* Storage may be unavailable. */ }

function localized(card) {
  const spanish = $('language').value === 'es';
  const backup = spanish ? spanishImageBackups[card.id] : undefined;
  // Basic Water Energy printings are interchangeable for deck construction.
  const alternateImage = card.key === 'water'
    ? 'https://assets.tcgdex.net/' + (spanish ? 'es' : 'en') + '/xy/xy1/134'
    : undefined;
  const spanishImages = spanish ? [card.es?.image, backup?.image, alternateImage].filter(Boolean) : [];
  return {
    name: (spanish && (card.es?.name || backup?.name || (alternateImage && 'Energía Agua'))) || card.name,
    image: card.image,
    spanish,
    spanishImages,
    alternateImage,
    source: backup?.source ?? card.source
  };
}

function cardCategory(card) {
  if (card.group === 'Energía') return 'Energías';
  if (['Magikarp', 'Evolución', 'Pokémon'].includes(card.group)) return 'Pokémon';
  return 'Entrenadores';
}

function renderCatalog() {
  const raw = $('search').value.trim();
  const query = normalize(raw);
  const category = $('category').value;
  const matching = [...cards.values()].filter(card => card.key !== 'water' && (!category || cardCategory(card) === category) &&
    [card.name, localized(card).name, card.id].some(value => normalize(value).includes(query)));
  $('catalog').replaceChildren(...matching.slice(0, limit).map(card => {
    const translated = localized(card);
    const tile = el('article', null, {class: 'tile'});
    const preview = button(null, () => openCardDetail(card));
    preview.className = 'tile-preview';
    preview.dataset.cardId = card.id;
    preview.setAttribute('aria-haspopup', 'dialog');
    preview.setAttribute('aria-label', 'Ver detalle de ' + translated.name + ' (' + card.id + ')');
    const placeholder = el('span', 'Imagen no disponible', {class: 'placeholder'});
    const image = el('img', null, {alt: '', loading: 'lazy'});
    preview.append(image);
    const summary = card.id + ' · Máx. ' + card.max;
    const imageLabel = el('small', summary +
      (translated.spanish && !translated.spanishImages.length && translated.image ? ' · Imagen en inglés' : ''));
    image.onload = () => {
      imageLabel.textContent = summary +
        (needsEnglishImageNotice(translated, image.src) ? ' · Imagen en inglés' : '');
      if (usesImage(translated.alternateImage, image.src) &&
          !usesImage(card.es?.image, image.src) && !usesImage(card.image, image.src)) {
        image.title = 'Imagen de otra impresión de Energía Agua básica (XY1-134)';
      }
    };
    setCardImage(image, translated, 'low', () => {
      imageLabel.textContent = summary;
      image.replaceWith(placeholder);
    });
    preview.append(el('strong', translated.name), imageLabel);
    tile.append(preview, button('Añadir', () => {
      if (canAdd(deck, cards, card.id)) change(card.id, 1);
    }, !canAdd(deck, cards, card.id)));
    return tile;
  }));
  $('more').hidden = matching.length <= limit;
  if (ready && !matching.length) $('catalog').append(el('p', 'No hay cartas para esta búsqueda.'));
}

function updateCardDetail() {
  if (!$('card-detail').open) return;
  const card = cards.get(detailCardId);
  const quantity = deck[detailCardId] ?? 0;
  const allowed = canAdd(deck, cards, detailCardId);
  $('card-detail-status').textContent = 'Copias en tu baraja: ' + quantity +
    (allowed ? '' : '. Los límites actuales de tu baraja impiden añadir otra.');
  $('card-detail-add').disabled = !allowed;
}

function openCardDetail(card) {
  const dialog = $('card-detail');
  const translated = localized(card);
  const imageArea = $('card-detail-image');
  const image = el('img', null, {alt: 'Carta de ' + translated.name});
  detailCardId = card.id;
  $('card-detail-title').textContent = translated.name;
  $('card-detail-meta').textContent = cardCategory(card) + ' · ' + card.id + ' · Máx. ' + card.max;
  const languageNote = $('card-detail-language');
  languageNote.textContent = '';
  image.onload = () => {
    languageNote.textContent = needsEnglishImageNotice(translated, image.src) ? 'Imagen disponible en inglés.' : '';
  };
  $('card-detail-source').replaceChildren(...(translated.source
    ? [el('a', 'Consultar la carta original ↗', {href: translated.source, target: '_blank', rel: 'noopener'})]
    : []));
  imageArea.replaceChildren(image);
  setCardImage(image, translated, 'high', () =>
    image.replaceWith(el('span', 'Imagen no disponible', {class: 'placeholder'})));
  dialog.showModal();
  updateCardDetail();
}

$('card-detail-close').onclick = () => $('card-detail').close();
$('card-detail-add').onclick = () => {
  if (canAdd(deck, cards, detailCardId)) change(detailCardId, 1);
};
$('card-detail').addEventListener('close', () => {
  if (!$('deck-builder').closest('[hidden]')) {
    const preview = [...$('catalog').querySelectorAll('.tile-preview')]
      .find(button => button.dataset.cardId === detailCardId);
    preview?.focus({preventScroll: true});
  }
});

function change(id, difference) {
  deck[id] = (deck[id] ?? 0) + difference;
  if (deck[id] === 0) delete deck[id];
  render();
}

function canPrint() {
  const {total} = status(deck, cards);
  return !printing && (total >= 1 || $('include-break-token').checked) &&
    total <= 60 && Object.keys(deck).every(id => cards.has(id));
}

function render() {
  try { localStorage.setItem('epic-deck', JSON.stringify(deck)); } catch { /* Optional storage. */ }
  const state = status(deck, cards);
  $('total').textContent = state.total + ' / 60';
  $('requirements').replaceChildren(...[
    [state.fish === 4, state.fish + '/4 Magikarp'],
    [state.water + state.splash === 6 && state.water >= 3, state.water + ' Agua básica + ' + state.splash + ' Salpicadura / 6'],
    [state.evolutions === 5, state.evolutions + '/5 evoluciones distintas'],
    [state.valid, state.valid ? 'Baraja válida' : 'Completa los requisitos del formato']
  ].map(([ok, label]) => el('li', (ok ? '✓ ' : '○ ') + label)));
  $('deck').replaceChildren(...Object.entries(deck).map(([id, quantity]) => {
    const card = cards.get(id);
    const name = card ? localized(card).name : id;
    const row = el('div', null, {class: 'deck-row'});
    const minus = button('−', () => change(id, -1));
    minus.setAttribute('aria-label', 'Quitar ' + name);
    const plus = button('+', () => change(id, 1), !canAdd(deck, cards, id));
    plus.setAttribute('aria-label', 'Añadir ' + name);
    row.append(el('span', name), el('b', quantity), minus, plus);
    return row;
  }));
  const addWater = $('add-basic-water');
  addWater.hidden = !basicWaterId;
  addWater.disabled = !canAdd(deck, cards, basicWaterId);
  $('print').disabled = !canPrint();
  renderCatalog();
  updateCardDetail();
}

$('add-basic-water').onclick = () => {
  if (canAdd(deck, cards, basicWaterId)) change(basicWaterId, 1);
};

$('clear').onclick = () => { if (!Object.keys(deck).length || confirm('¿Vaciar tu baraja?')) { deck = {}; render(); } };
for (const id of ['search', 'category', 'language']) $(id).addEventListener('input', () => { limit = 24; render(); });
$('more').onclick = () => { limit += 24; renderCatalog(); };
$('include-break-token').onchange = () => { $('print').disabled = !canPrint(); };
$('print').onclick = async () => {
  if (!canPrint()) return;
  const selected = Object.entries(deck).flatMap(([id, n]) => Array(n).fill(localized(cards.get(id))));
  if ($('include-break-token').checked) {
    selected.push({
      name: 'Token de Magikarp BREAK',
      image: './assets/magikarp-break-token.png',
      landscape: true
    });
  }
  const note = $('print-status');
  const sheets = $('print-sheet');
  const missingImages = selected.filter(card => !imageOptions(card, 'high').length);
  if (missingImages.length) {
    note.textContent = 'Faltan imágenes para: ' + [...new Set(missingImages.map(card => card.name))].join(', ');
    return;
  }
  printing = true;
  $('print').disabled = true;
  note.textContent = 'Preparando imágenes…';
  try {
    sheets.replaceChildren();
    const downloads = [];
    for (let i = 0; i < selected.length; i += 9) {
      const page = el('div', null, {class: 'print-page'});
      for (const card of selected.slice(i, i + 9)) {
        const image = el('img', null, {alt: card.name});
        if (card.landscape) image.classList.add('print-landscape');
        page.append(image);
        downloads.push(new Promise((resolve, reject) => {
          image.onload = () => resolve(needsEnglishImageNotice(card, image.src));
          setCardImage(image, card, 'high', () => reject(new Error(card.name)));
        }));
      }
      sheets.append(page);
    }
    const englishImages = await Promise.race([
      Promise.all(downloads),
      new Promise((_, reject) => setTimeout(() => reject(new Error('tiempo de espera agotado')), 30000))
    ]);
    note.textContent = 'Imprime al 100 %, sin encabezados ni pies de página.';
    if (!englishImages.includes(true) || confirm('Algunas cartas tienen imagen en inglés. ¿Imprimir las imágenes disponibles?')) {
      window.print();
    }
  } catch (error) { note.textContent = 'No se pudo preparar la impresión: ' + error.message + '.'; }
  finally { sheets.replaceChildren(); printing = false; $('print').disabled = !canPrint(); }
};

render();
catalog().then(result => {
  cards = result.cards;
  basicWaterId = cards.get('xy1-134')?.key === 'water'
    ? 'xy1-134'
    : [...cards.values()].find(card => card.key === 'water')?.id;
  isPocket = result.isPocket;
  deck = cleanDeck(deck);
  ready = true;
  const visibleCount = [...cards.values()].filter(card => card.key !== 'water').length;
  const notes = [visibleCount + ' impresiones disponibles'];
  if (!result.spanishAvailable) notes.push('catálogo en español temporalmente inaccesible');
  if (result.missing.length) notes.push('sin coincidencia en TCGdex: ' + result.missing.join(', '));
  if (result.failed.length) notes.push(result.failed.length + ' evoluciones pendientes de verificar');
  $('catalog-status').textContent = notes.join(' · ');
  render();
}).catch(() => {
  $('catalog-status').replaceChildren('No se pudo cargar el catálogo. ', button('Reintentar', () => location.reload()));
});

connect({
  snapshot: () => ({...deck}),
  load: candidate => { deck = cleanDeck(candidate); render(); }
});
