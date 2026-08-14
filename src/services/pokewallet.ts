import { Card, Price } from '../types';

const BASE = 'https://api.pokewallet.io';
const proxy = process.env.EXPO_PUBLIC_POKEWALLET_PROXY_URL?.trim().replace(/\/$/, '');
const key = process.env.EXPO_PUBLIC_POKEWALLET_API_KEY?.trim();

function headers(): Record<string,string> { return key ? { 'X-API-Key': key } : {}; }
function endpoint(path: string) { return `${proxy || BASE}${path}`; }
function assertConfigured() {
  if (!proxy && !key) {
    throw new Error('PokéWallet is not configured. Add EXPO_PUBLIC_POKEWALLET_API_KEY to .env and restart Expo.');
  }
}
function prices(raw: any): Price[] {
  const t = (raw.tcgplayer?.prices ?? []).map((p: any) => ({ market: p.market_price ?? null, low: p.low_price ?? null, high: p.high_price ?? null, source: 'TCGplayer', variant: p.variant_type }));
  const c = (raw.cardmarket?.prices ?? []).map((p: any) => ({ market: p.trend ?? p.avg ?? null, low: p.low ?? null, high: null, source: 'Cardmarket', variant: p.variant_type }));
  return [...t, ...c];
}
function mapCard(raw: any, i = 0): Card {
  const x = raw.card_info ?? raw;
  return { id: raw.id, name: x.name ?? x.clean_name, setName: x.set_name ?? 'Unknown set', setCode: x.set_code ?? '', number: x.card_number ?? '—', rarity: x.rarity ?? 'Unknown', type: x.card_type ?? 'Pokémon', hp: x.hp, stage: x.stage, text: x.card_text, attacks: x.attacks, weakness: x.weakness, imageUrl: endpoint(`/images/${encodeURIComponent(raw.id)}?size=high`), prices: prices(raw), confidence: Math.max(.55, .96 - i * .08) };
}
export async function searchCards(query: string): Promise<Card[]> {
  assertConfigured();
  if (!query.trim()) throw new Error('No searchable card text was detected.');
  const res = await fetch(endpoint(`/search?q=${encodeURIComponent(query)}&limit=12`), { headers: headers() });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'PokéWallet rejected the API key.' : res.status === 429 ? 'Search limit reached. Try again shortly.' : `PokéWallet search failed (${res.status}).`);
  const json = await res.json(); return (json.results ?? []).map(mapCard);
}
export async function getCard(id: string): Promise<Card> {
  assertConfigured();
  const res = await fetch(endpoint(`/cards/${encodeURIComponent(id)}`), { headers: headers() });
  if (!res.ok) throw new Error(`Could not load card (${res.status}).`); return mapCard(await res.json());
}
export function cardImageSource(card: Card) { return key && !proxy ? { uri: card.imageUrl, headers: headers() } : { uri: card.imageUrl }; }
