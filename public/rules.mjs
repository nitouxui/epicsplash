export const TOTAL = 60;
export const species = ['Jolteon', 'Vaporeon', 'Flareon', 'Espeon', 'Umbreon', 'Glaceon', 'Leafeon', 'Sylveon'];
export const magikarp = ['xyp-XY143', 'xy7-19', 'g1-22', 'mcd16-4'];
export const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export function count(deck) {
  return Object.values(deck).reduce((sum, quantity) => sum + quantity, 0);
}

export function tally(deck, cards) {
  const groups = new Map();
  for (const [id, quantity] of Object.entries(deck)) {
    const card = cards.get(id);
    if (card) groups.set(card.key, (groups.get(card.key) ?? 0) + quantity);
  }
  return groups;
}

export function status(deck, cards) {
  const groups = tally(deck, cards);
  const water = groups.get('water') ?? 0;
  const splash = groups.get('splash') ?? 0;
  const evolutions = species.reduce((n, name) => n + (groups.get(name) ?? 0), 0);
  const fish = groups.get('magikarp') ?? 0;
  const total = count(deck);
  const limits = Object.entries(deck).every(([id, quantity]) => {
    const card = cards.get(id);
    return card && Number.isInteger(quantity) && quantity > 0 && groups.get(card.key) <= card.max;
  });
  return { total, water, splash, evolutions, fish, valid: limits && total === TOTAL && fish === 4 &&
    water >= 3 && splash <= 3 && water + splash === 6 && evolutions === 5 };
}

export function canAdd(deck, cards, id) {
  const card = cards.get(id);
  if (!card || count(deck) >= TOTAL) return false;
  if ((tally(deck, cards).get(card.key) ?? 0) >= card.max) return false;
  const next = status({...deck, [id]: (deck[id] ?? 0) + 1}, cards);
  return next.evolutions <= 5 && next.water + next.splash <= 6 &&
    next.total - next.fish - next.water - next.splash - next.evolutions <= 45;
}
