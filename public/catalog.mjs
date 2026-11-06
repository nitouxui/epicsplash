import { magikarp, normalize, species } from './rules.mjs';

const api = 'https://api.tcgdex.net/v2';
const get = async url => {
  const response = await fetch(url, {signal: AbortSignal.timeout(25000)});
  if (!response.ok) throw new Error('No se pudo cargar ' + url);
  return response.json();
};

function classify(card, legality) {
  const name = normalize(card.name);
  const id = card.id.toLowerCase();
  if (magikarp.some(value => value.toLowerCase() === id))
    return {key: 'magikarp', max: 4, group: 'Magikarp'};
  if (name === 'waterenergy' || name === 'basicwaterenergy')
    return {key: 'water', max: 6, group: 'Energía'};
  if (name === 'splashenergy') return {key: 'splash', max: 3, group: 'Energía'};
  return legality.find(rule => rule.exact ? rule.exact.includes(id) : normalize(rule.name) === name);
}

export async function catalog() {
  const [english, legality, pocket] = await Promise.all([
    get(api + '/en/cards'), get('./legality.json'), get(api + '/en/series/tcgp')
  ]);
  if (!pocket.sets?.length) throw new Error('No se pudo identificar la serie Pocket.');
  const pocketPrefixes = pocket.sets.map(set => set.id + '-');
  const isPocket = id => pocketPrefixes.some(prefix => id.startsWith(prefix));
  const spanish = get(api + '/es/cards').then(rows => ({
    cards: new Map(rows.map(card => [card.id, card])), available: true
  })).catch(() => ({cards: new Map(), available: false}));
  const cards = new Map();
  const covered = new Set();
  const evolutions = [];
  for (const card of english) {
    if (isPocket(card.id)) continue;
    const rule = classify(card, legality);
    if (rule) {
      cards.set(card.id, {...card, ...rule, name: card.name});
      covered.add(rule);
    } else {
      const family = species.find(name => new RegExp('\\b' + name + '\\b', 'i').test(card.name));
      if (family && !/^(m |mega )| (v|vmax|vstar|ex|fb|star|gold star|lv\.x)$/i.test(card.name)) {
        // Lowercase ex can evolve. Confirm every candidate against the card data.
        evolutions.push([card, family]);
      } else if (family && / ex$/.test(card.name)) {
        evolutions.push([card, family]);
      }
    }
  }
  if (!cards.has('mcd16-4')) {
    cards.set('mcd16-4', {id: 'mcd16-4', name: 'Magikarp', key: 'magikarp', max: 4,
      group: 'Magikarp', image: 'https://pkmncards.com/wp-content/uploads/en_US-MCD16-004-magikarp.jpg'});
  }
  const failed = [];
  for (let i = 0; i < evolutions.length; i += 20) {
    await Promise.all(evolutions.slice(i, i + 20).map(async ([card, family]) => {
      try {
        const detail = await get(api + '/en/cards/' + encodeURIComponent(card.id));
        if (normalize(detail.evolveFrom ?? '') === 'eevee' && normalize(detail.stage ?? '') === 'stage1')
          cards.set(card.id, {...card, key: family, max: 1, group: 'Evolución'});
      } catch { failed.push(card.name); }
    }));
  }
  const localized = await spanish;
  for (const card of cards.values()) card.es = localized.cards.get(card.id);
  return {
    cards,
    isPocket,
    missing: legality.filter(rule => !covered.has(rule)).map(rule => rule.name),
    failed,
    spanishAvailable: localized.available
  };
}
