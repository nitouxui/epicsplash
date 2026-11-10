import { $, el, button } from './ui.mjs';
import { catalog, cardPreview } from './catalog.mjs?v=3';
import { canAdd, magikarp, normalize, species, status } from './rules.mjs';
import { connect } from './cloud.mjs?v=10';
import { spanishImageBackups, spanishReprints } from './spanish-image-backups.mjs?v=12';

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
const draftKey = isAdminPath ? 'epic-admin-deck' : 'epic-deck';
let temporaryDeck = false;
let limit = 24;
let preparingPDF = false;
let detailCardId;
let basicWaterId;
const previews = new Map();
const cardLabelsKey = 'epic-card-labels-v1';
let cardLabels = {};
try {
  cardLabels = JSON.parse(localStorage.getItem(cardLabelsKey)) ?? {};
} catch { /* Optional storage. */ }
function cleanDeck(candidate) {
  return Object.fromEntries(Object.entries(candidate ?? {}).filter(([id, n]) =>
    /^[a-z0-9.-]+$/i.test(id) && Number.isInteger(n) && n > 0 && n <= 60 && !isPocket(id)));
}

function usesImage(source, url) {
  if (!source) return false;
  const original = new URL(source, document.baseURI).href;
  const loaded = new URL(url, document.baseURI).href;
  return loaded === original || loaded.startsWith(original + '/');
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
  const saved = JSON.parse(localStorage.getItem(draftKey));
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    deck = cleanDeck(saved);
  }
} catch { /* Storage may be unavailable. */ }

function localized(card) {
  const spanish = $('language').value === 'es';
  const backup = spanish ? spanishImageBackups[card.id] : undefined;
  const [reprintId, reprintEdition] = spanish ? spanishReprints[card.id] ?? [] : [];
  const reprint = spanishImageBackups[reprintId];
  // Basic Water Energy printings are interchangeable for deck construction.
  const alternateImage = card.key === 'water'
    ? 'https://assets.tcgdex.net/' + (spanish ? 'es' : 'en') + '/xy/xy1/134'
    : undefined;
  const spanishImages = spanish ? [card.es?.image, backup?.image, reprint?.image, alternateImage].filter(Boolean) : [];
  return {
    name: (spanish && (card.es?.name || backup?.name || reprint?.name || (alternateImage && 'Energía Agua'))) || card.name,
    image: card.image,
    spanish,
    spanishImages,
    alternateImage,
    reprint,
    reprintEdition,
    source: backup?.source ?? card.source
  };
}

function imageNotice(card, url) {
  if (usesImage(card.reprint?.image, url)) return 'Imagen de otra edición en español · ' + card.reprintEdition;
  return needsEnglishImageNotice(card, url) ? 'Imagen en inglés' : '';
}

function cardCategory(card) {
  if (card.group === 'Energía') return 'Energías';
  if (['Magikarp', 'Evolución', 'Pokémon'].includes(card.group)) return 'Pokémon';
  return 'Entrenadores';
}

function renderCatalog() {
  const raw = $('search').value.trim();
  const query = normalize(raw);
  $('search-results').hidden = !query;
  if (!query) {
    $('catalog').replaceChildren();
    $('more').hidden = true;
    return;
  }
  const category = $('category').value;
  const familySearch = species.some(name => normalize(name) === query);
  const matching = [...cards.values()].filter(card => card.key !== 'water' && (!category || cardCategory(card) === category) &&
    (!familySearch || / ex$/i.test(card.name)) &&
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
      const notice = imageNotice(translated, image.src);
      imageLabel.textContent = notice ? summary + ' · ' + notice : summary;
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
  const showSource = source => $('card-detail-source').replaceChildren(...(source
    ? [el('a', 'Consultar la edición mostrada ↗', {href: source, target: '_blank', rel: 'noopener'})]
    : []));
  showSource(translated.source);
  image.onload = () => {
    languageNote.textContent = imageNotice(translated, image.src);
    if (usesImage(translated.reprint?.image, image.src)) showSource(translated.reprint.source);
  };
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
    const preview = [...$('deck-builder').querySelectorAll('.tile-preview')]
      .find(button => button.dataset.cardId === detailCardId);
    preview?.focus({preventScroll: true});
  }
});

function change(id, difference) {
  deck[id] = (deck[id] ?? 0) + difference;
  if (deck[id] === 0) delete deck[id];
  render();
}

function canDownloadPDF() {
  const {total} = status(deck, cards);
  return !preparingPDF && (total >= 1 || $('include-break-token').checked) &&
    total <= 60 && Object.keys(deck).every(id => cards.has(id));
}

function renderDeck() {
  const grid = $('deck-view').value === 'grid';
  $('deck').classList.toggle('deck-grid', grid);
  const groups = new Map(['Pokémon', 'Entrenadores', 'Energías', 'Por identificar']
    .map(category => [category, []]));
  for (const [id, quantity] of Object.entries(deck)) {
    const card = cards.get(id);
    if (!card && !previews.has(id)) {
      previews.set(id, null);
      cardPreview(id).then(preview => {
        previews.set(id, preview);
        if (preview && deck[id] && !cards.has(id)) renderDeck();
      });
    }
    const preview = previews.get(id);
    const label = cardLabels[id];
    const name = card || preview ? localized(card ?? preview).name
      : ($('language').value === 'es' ? label?.es : label?.en) ?? label?.en ?? id;
    const category = card ? cardCategory(card) : label?.category ??
      ({pokemon: 'Pokémon', trainer: 'Entrenadores', entrenador: 'Entrenadores',
        energy: 'Energías', energia: 'Energías'})[normalize(preview?.category ?? '')] ??
      (magikarp.includes(id) ? 'Pokémon' : 'Por identificar');
    groups.get(groups.has(category) ? category : 'Por identificar').push({id, quantity, card, name, preview});
  }
  const sections = [];
  for (const [category, entries] of groups) {
    if (!entries.length) continue;
    entries.sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id));
    const count = entries.reduce((sum, entry) => sum + entry.quantity, 0);
    const section = el('section', null, {class: 'deck-category'});
    const content = el('div', null, {class: 'deck-category-cards'});
    section.append(el('h5', category + ' · ' + count), content);
    sections.push(section);
    content.append(...entries.map(({id, quantity, card, name, preview}) => {
      const row = el('div', null, {class: 'deck-row'});
      const minus = button('−', () => change(id, -1));
      minus.setAttribute('aria-label', 'Quitar ' + name);
      const plus = button('+', () => change(id, 1), !canAdd(deck, cards, id));
      plus.setAttribute('aria-label', 'Añadir ' + name);
      row.append(el('b', quantity, {'aria-label': quantity + ' copias'}), minus, plus);
      if (!grid) {
        row.prepend(el('span', name));
        return row;
      }
      const tile = el('article', null, {class: 'tile deck-grid-card'});
      if (card) {
        const preview = button(null, () => openCardDetail(card));
        preview.className = 'tile-preview';
        preview.dataset.cardId = id;
        preview.setAttribute('aria-haspopup', 'dialog');
        const image = el('img', null, {alt: '', loading: 'lazy'});
        preview.append(image, el('strong', name));
        setCardImage(image, localized(card), 'low', () => {
          image.replaceWith(el('span', 'Imagen no disponible', {class: 'placeholder'}));
        });
        tile.append(preview);
      } else {
        tile.append(el('strong', name));
        if (preview) {
          const image = el('img', null, {alt: '', loading: 'lazy'});
          tile.prepend(image);
          setCardImage(image, localized(preview), 'low', () => image.remove());
        }
      }
      tile.append(row);
      return tile;
    }));
  }
  $('deck').replaceChildren(...(sections.length ? sections : [
    el('p', 'Tu baraja todavía está vacía.', {class: 'muted'})
  ]));
}

function render() {
  try {
    if (!temporaryDeck) localStorage.setItem(draftKey, JSON.stringify(deck));
  } catch { /* Optional storage. */ }
  const state = status(deck, cards);
  $('total').textContent = state.total + ' / 60';
  renderDeck();
  const addWater = $('add-basic-water');
  addWater.hidden = !basicWaterId;
  addWater.disabled = !canAdd(deck, cards, basicWaterId);
  $('print').disabled = !canDownloadPDF();
  renderCatalog();
  updateCardDetail();
}

$('add-basic-water').onclick = () => {
  if (canAdd(deck, cards, basicWaterId)) change(basicWaterId, 1);
};

$('clear').onclick = () => { if (!Object.keys(deck).length || confirm('¿Vaciar tu baraja?')) { deck = {}; render(); } };
for (const id of ['search', 'category', 'language']) $(id).addEventListener('input', () => { limit = 24; render(); });
$('more').onclick = () => { limit += 24; renderCatalog(); };
$('deck-view').onchange = render;
$('include-break-token').onchange = () => { $('print').disabled = !canDownloadPDF(); };
async function loadProxyImage(card) {
  const urls = new Set([...imageOptions(card, 'high'), ...imageOptions(card, 'low')]);
  for (const url of urls) {
    const english = needsEnglishImageNotice(card, url);
    const imageId = usesImage(card.reprint?.image, url) ? spanishReprints[card.id][0] : card.id;
    const backup = spanishImageBackups[imageId]?.image;
    const localSpanish = url === backup && /limitlesstcg\.nyc3\.cdn|tiendaslevelup\.cl/.test(url);
    const localEnglish = !usesImage(backup, url) &&
      (card.id === 'mcd16-4' || card.id === 'sm3.5-58') && url === card.image;
    const source = localSpanish || localEnglish
      ? './assets/pdf/' + imageId + (localSpanish ? '-es.jpg' : '-en.jpg')
      : url;
    try {
      const response = await fetch(source, {signal: AbortSignal.timeout(8000)});
      if (!response.ok) continue;
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = 430;
      canvas.height = 600;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (card.landscape) {
        context.translate(0, canvas.height);
        context.rotate(-Math.PI / 2);
        context.drawImage(bitmap, 0, 0, canvas.height, canvas.width);
      } else context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return {data: canvas.toDataURL('image/jpeg', .92), english};
    } catch { /* Try the next source. */ }
  }
  throw new Error(card.name);
}

$('print').onclick = async () => {
  if (!canDownloadPDF()) return;
  const selected = Object.entries(deck).flatMap(([id, n]) => Array(n).fill({id, ...localized(cards.get(id))}));
  if ($('include-break-token').checked) {
    selected.push({
      name: 'Token de Magikarp BREAK',
      image: './assets/magikarp-break-token.png',
      landscape: true
    });
  }
  const note = $('print-status');
  preparingPDF = true;
  $('print').disabled = true;
  note.textContent = 'Preparando imágenes para el PDF…';
  try {
    const unique = [...new Set(selected)];
    const [{jsPDF}, results] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/jspdf@4.2.0/+esm'),
      Promise.allSettled(unique.map(loadProxyImage))
    ]);
    const missing = unique.filter((_, index) => results[index].status === 'rejected');
    if (missing.length) throw new Error('faltan imágenes para ' + [...new Set(missing.map(card => card.name))].join(', '));
    if (results.some(result => result.value.english) &&
        !confirm('Algunas cartas solo tienen imagen disponible en inglés. ¿Descargar el PDF con esas imágenes?')) {
      note.textContent = 'Descarga cancelada.';
      return;
    }
    const images = new Map(unique.map((card, index) => [card, {index, ...results[index].value}]));
    const pdf = new jsPDF({unit: 'mm', format: 'a4', compress: true});
    pdf.setProperties({title: 'Epic Splash · Proxies'});
    selected.forEach((card, index) => {
      const position = index % 9;
      if (index && !position) pdf.addPage();
      const x = 10.5 + (position % 3) * 63;
      const y = 7 + Math.floor(position / 3) * 88;
      const image = images.get(card);
      pdf.addImage(image.data, 'JPEG', x, y, 63, 88, 'card-' + image.index);
      pdf.setDrawColor(68);
      pdf.setLineWidth(.15);
      pdf.setLineDashPattern([1, .8], 0);
      pdf.rect(x, y, 63, 88);
    });
    pdf.save('epic-splash-proxies.pdf');
    note.textContent = 'PDF descargado. Para conservar el tamaño de las cartas, imprime al 100 %.';
  } catch (error) {
    note.textContent = 'No se pudo preparar el PDF: ' + error.message + '.';
  } finally {
    preparingPDF = false;
    $('print').disabled = !canDownloadPDF();
  }
};

function applyCatalog(result) {
  cards = result.cards;
  basicWaterId = cards.get('xy1-134')?.key === 'water'
    ? 'xy1-134'
    : [...cards.values()].find(card => card.key === 'water')?.id;
  isPocket = result.isPocket;
  deck = cleanDeck(deck);
}

render();
catalog(result => {
  applyCatalog(result);
  $('catalog-status').textContent = 'Puedes buscar cartas mientras verificamos las evoluciones.';
  render();
}).then(result => {
  applyCatalog(result);
  ready = true;
  cardLabels = Object.fromEntries([...cards.values()].map(card => [
    card.id, {
      en: card.name, es: card.es?.name ?? spanishImageBackups[card.id]?.name,
      category: cardCategory(card)
    }
  ]));
  try { localStorage.setItem(cardLabelsKey, JSON.stringify(cardLabels)); } catch { /* Optional storage. */ }
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
  load: (candidate, temporary = false) => {
    temporaryDeck = temporary;
    deck = cleanDeck(candidate);
    render();
  }
});
