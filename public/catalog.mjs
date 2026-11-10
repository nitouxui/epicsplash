const api = 'https://api.tcgdex.net/v2';
const get = async (url, timeout = 25000) => {
  const response = await fetch(url, {signal: AbortSignal.timeout(timeout)});
  if (!response.ok) throw new Error('No se pudo cargar ' + url);
  return response.json();
};

export async function cardPreview(id) {
  const path = '/cards/' + encodeURIComponent(id);
  const [english, spanish] = await Promise.allSettled([
    get(api + '/en' + path, 8000), get(api + '/es' + path, 8000)
  ]);
  if (english.status === 'fulfilled') {
    return {...english.value, es: spanish.status === 'fulfilled' ? spanish.value : undefined};
  }
  if (spanish.status === 'fulfilled') return {...spanish.value, es: spanish.value};
}

export async function catalog() {
  const {cards, pocketPrefixes, missing} = await get('./catalog-index.json?v=1', 8000);
  return {
    cards: new Map(cards.map(card => [card.id, card])),
    isPocket: id => pocketPrefixes.some(prefix => id.startsWith(prefix)),
    missing
  };
}
