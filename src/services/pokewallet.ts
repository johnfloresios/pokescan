import { Card, Price } from '../types';
import type { ScanHints } from './scanner';
import { similarity } from './card-matcher';

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
  const tcg = raw.tcgplayer?.prices ?? [];
  const market = raw.cardmarket?.prices ?? [];
  const tcgRows = Array.isArray(tcg) ? tcg : Object.entries(tcg).map(([variant, value]) => ({ ...(value as object), variant_type: variant }));
  const marketRows = Array.isArray(market) ? market : [market];
  const t = tcgRows.map((p: any) => ({ market: p.market_price ?? p.market ?? null, low: p.low_price ?? p.low ?? null, high: p.high_price ?? p.high ?? null, source: 'TCGplayer', variant: p.variant_type }));
  const c = marketRows.filter(Boolean).map((p: any) => ({ market: p.trend ?? p.trendPrice ?? p.avg ?? p.averageSellPrice ?? null, low: p.low ?? p.lowPrice ?? null, high: null, source: 'Cardmarket', variant: p.variant_type }));
  return [...t, ...c];
}
function mapCard(raw: any, i = 0): Card {
  const x = raw.card_info ?? raw;
  const set = x.set ?? raw.set ?? {};
  const imageUrl = x.images?.large ?? raw.images?.large ?? x.image_url ?? raw.image_url ?? x.image ?? raw.image
    ?? x.images?.small ?? raw.images?.small ?? endpoint(`/images/${encodeURIComponent(raw.id)}?size=high`);
  const abilities = (x.abilities ?? x.ability ?? []).map ? (x.abilities ?? x.ability ?? []).map((ability: any) => typeof ability === 'string' ? ability : [ability.name, ability.text].filter(Boolean).join(' · ')) : [String(x.ability)];
  const attacks = (x.attacks ?? []).map((attack: any) => typeof attack === 'string' ? attack : [attack.name, attack.damage, attack.text].filter(Boolean).join(' · '));
  const retreat = x.retreat_cost ?? x.retreatCost;
  return { id: raw.id, name: x.name ?? x.clean_name, setName: x.set_name ?? set.name ?? 'Unknown set', setCode: x.set_code ?? set.ptcgoCode ?? set.id ?? '', number: x.card_number ?? x.number ?? '—', printedTotal: String(x.printed_total ?? x.set_total ?? set.printedTotal ?? set.total ?? ''), rarity: x.rarity ?? 'Unknown', type: x.card_type ?? x.types?.[0] ?? x.supertype ?? 'Pokémon', hp: x.hp, stage: x.stage ?? x.subtypes?.join(' · '), text: x.card_text ?? x.flavorText ?? x.rules?.join(' '), attacks, weakness: x.weakness ?? x.weaknesses?.map((item: any) => `${item.type} ${item.value}`).join(', '), evolvesFrom: x.evolves_from ?? x.evolvesFrom ?? x.evolution_from, resistance: x.resistance ?? x.resistances?.map((item: any) => `${item.type} ${item.value}`).join(', '), retreatCost: Array.isArray(retreat) ? retreat.join(', ') : retreat, illustrator: x.illustrator ?? x.artist, regulationMark: x.regulation_mark ?? x.regulationMark, abilities, imageUrl, prices: prices(raw), confidence: Math.max(.55, .96 - i * .08) };
}
export async function searchCards(query: string): Promise<Card[]> {
  assertConfigured();
  if (!query.trim()) throw new Error('No searchable card text was detected.');
  const res = await fetch(endpoint(`/search?q=${encodeURIComponent(query)}&limit=12`), { headers: headers() });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'PokéWallet rejected the API key.' : res.status === 429 ? 'Search limit reached. Try again shortly.' : `PokéWallet search failed (${res.status}).`);
  const json = await res.json(); return (json.results ?? []).map(mapCard);
}
export function rankCards(cards: Card[], hints: ScanHints): Card[] {
  const normalized = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  const words = (value?: string) => new Set((value?.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(word => !['pokemon', 'basic', 'stage', 'damage', 'during', 'this', 'that', 'from', 'your'].includes(word)));
  const wantedNumber = normalized(hints.number?.split('/')[0]);
  const wantedName = normalized(hints.name);
  const wantedSet = normalized(hints.setCode);
  const wantedSetName = normalized(hints.setName);
  const wantedType = normalized(hints.type);
  const wantedRarity = normalized(hints.rarity);
  const wantedStage = normalized(hints.stage);
  const wantedBottom = normalized(hints.bottomIdentifier);
  const wantedTotal = normalized(hints.collectorTotal);
  const wantedNumbers = new Set(hints.numericEvidence ?? []);
  const evidenceWords = words(hints.evidence);
  const scored = cards.map((card, index) => {
    let score = 100 - index;
    const resultFullIdentifiers = [normalized(card.number), normalized(`${card.setCode}${card.number.split('/')[0]}`)];
    const fractionBottomMatches = hints.bottomIdentifier?.includes('/')
      && normalized(card.number.split('/')[0]) === normalized(hints.bottomIdentifier.split('/')[0])
      && (!card.printedTotal || normalized(card.printedTotal) === normalized(hints.bottomIdentifier.split('/')[1]));
    if (wantedBottom && (resultFullIdentifiers.includes(wantedBottom) || fractionBottomMatches)) score += 200;
    else if (wantedBottom) score -= 120;
    const resultNumber = normalized(card.number.split('/')[0]);
    if (wantedNumber && resultNumber === wantedNumber) score += 100;
    else if (wantedNumber && resultNumber) score -= 100;
    if (wantedName && normalized(card.name) === wantedName) score += 40;
    else if (wantedName) score += Math.round(similarity(hints.name, card.name) * 40);
    if (wantedSet && normalized(card.setCode) === wantedSet) score += 50;
    if (wantedSetName && normalized(card.setName).includes(wantedSetName)) score += 45;
    if (wantedTotal && normalized(card.printedTotal) === wantedTotal) score += 60;
    else if (wantedTotal && card.printedTotal) score -= 40;
    if (hints.hp && card.hp === hints.hp) score += 25;
    else if (hints.hp && card.hp) score -= 30;
    if (wantedType && normalized(card.type).includes(wantedType)) score += 20;
    if (wantedRarity && normalized(card.rarity).includes(wantedRarity)) score += 18;
    if (wantedStage && normalized(card.stage).includes(wantedStage)) score += 15;
    const cardEvidence = [card.rarity, card.setName, card.text, card.evolvesFrom, ...(card.abilities ?? []), ...(card.attacks ?? [])].filter(Boolean).join(' ');
    const evidenceMatches = [...words(cardEvidence)].filter(word => evidenceWords.has(word)).length;
    score += Math.min(30, evidenceMatches * 5);
    const resultNumbers = new Set((cardEvidence.match(/\b\d{1,3}\b/g) ?? []).map(value => value.replace(/^0+/, '') || '0'));
    const numericMatches = [...wantedNumbers].filter(value => resultNumbers.has(value)).length;
    score += Math.min(36, numericMatches * 12);
    return { card, score };
  }).sort((a, b) => b.score - a.score);
  const bestScore = scored[0]?.score ?? 0;
  return scored.filter(item => item.score >= Math.max(80, bestScore - 55)).slice(0, 5).map(({ card, score }, index) => ({
    ...card,
    confidence: Math.max(.55, Math.min(.99, .58 + score / 400 - index * .04)),
  }));
}
export async function getCard(id: string): Promise<Card> {
  assertConfigured();
  const res = await fetch(endpoint(`/cards/${encodeURIComponent(id)}`), { headers: headers() });
  if (!res.ok) throw new Error(`Could not load card (${res.status}).`); return mapCard(await res.json());
}
export function cardImageSource(card: Card) { return key && !proxy ? { uri: card.imageUrl, headers: headers() } : { uri: card.imageUrl }; }
