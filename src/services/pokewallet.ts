import { Card, Price } from '../types';

const BASE = 'https://api.pokewallet.io';
const proxy = process.env.EXPO_PUBLIC_POKEWALLET_PROXY_URL?.replace(/\/$/, '');
const key = process.env.EXPO_PUBLIC_POKEWALLET_API_KEY;

const demo: Card[] = [
  { id: 'demo-pikachu-1', name: 'Pikachu ex', setName: 'Paldea Evolved', setCode: 'PAL', number: '063/193', rarity: 'Double Rare', type: 'Lightning', hp: '190', stage: 'Basic', text: 'A cheerful spark can turn the whole battle around.', attacks: ['Pika Punch · 30', 'Dynamic Bolt · 220'], weakness: 'Fighting ×2', imageUrl: 'https://images.pokemontcg.io/sv2/63_hires.png', confidence: .96, prices: [{ market: 2.18, low: 1.64, high: 7.99, source: 'TCGplayer', variant: 'Holofoil' }] },
  { id: 'demo-pikachu-2', name: 'Pikachu', setName: 'Scarlet & Violet—151', setCode: 'MEW', number: '025/165', rarity: 'Common', type: 'Lightning', hp: '60', stage: 'Basic', imageUrl: 'https://images.pokemontcg.io/sv3pt5/25_hires.png', confidence: .82, prices: [{ market: .12, low: .05, high: 1.3, source: 'TCGplayer', variant: 'Normal' }] },
  { id: 'demo-pikachu-3', name: 'Pikachu ex', setName: 'Surging Sparks', setCode: 'SSP', number: '057/191', rarity: 'Double Rare', type: 'Lightning', hp: '200', stage: 'Basic', imageUrl: 'https://images.pokemontcg.io/sv8/57_hires.png', confidence: .74, prices: [{ market: 1.46, low: .91, high: 5.0, source: 'TCGplayer', variant: 'Holofoil' }] }
];

function headers(): Record<string,string> { return key ? { 'X-API-Key': key } : {}; }
function endpoint(path: string) { return `${proxy || BASE}${path}`; }
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
  if (!proxy && !key) { await new Promise(r => setTimeout(r, 1000)); return demo; }
  const res = await fetch(endpoint(`/search?q=${encodeURIComponent(query)}&limit=12`), { headers: headers() });
  if (!res.ok) throw new Error(res.status === 429 ? 'Search limit reached. Try again shortly.' : `PokéWallet search failed (${res.status}).`);
  const json = await res.json(); return (json.results ?? []).map(mapCard);
}
export async function getCard(id: string): Promise<Card> {
  const local = demo.find(x => x.id === id); if (local) return local;
  const res = await fetch(endpoint(`/cards/${encodeURIComponent(id)}`), { headers: headers() });
  if (!res.ok) throw new Error(`Could not load card (${res.status}).`); return mapCard(await res.json());
}
export function cardImageSource(card: Card) { return key && !proxy && !card.id.startsWith('demo-') ? { uri: card.imageUrl, headers: headers() } : { uri: card.imageUrl }; }
