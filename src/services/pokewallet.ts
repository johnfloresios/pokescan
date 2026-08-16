import { Card, Price } from '../types';
import type { ScanHints } from './scanner';
import { similarity } from './card-matcher';

const BASE = 'https://api.pokewallet.io';
const proxy = process.env.EXPO_PUBLIC_POKEWALLET_PROXY_URL?.trim().replace(/\/$/, '');
const key = process.env.EXPO_PUBLIC_POKEWALLET_API_KEY?.trim();

function headers(): Record<string,string> { return key ? { 'X-API-Key': key } : {}; }
function endpoint(path: string) { return `${proxy || BASE}${path}`; }
function plainText(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/<\/p\s*>/gi, ' · ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s*·\s*(?:·\s*)+/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}
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
  const abilities = (x.abilities ?? x.ability ?? []).map ? (x.abilities ?? x.ability ?? []).map((ability: any) => plainText(typeof ability === 'string' ? ability : [ability.name, ability.text].filter(Boolean).join(' · '))).filter(Boolean) : [plainText(x.ability)].filter(Boolean);
  const attacks = (x.attacks ?? []).map((attack: any) => plainText(typeof attack === 'string' ? attack : [attack.name, attack.damage, attack.text].filter(Boolean).join(' · '))).filter(Boolean);
  const retreat = x.retreat_cost ?? x.retreatCost;
  return { id: raw.id, name: plainText(x.name ?? x.clean_name), setName: plainText(x.set_name ?? set.name ?? 'Unknown set'), setCode: plainText(x.set_code ?? set.ptcgoCode ?? set.id ?? ''), number: plainText(x.card_number ?? x.number ?? '—'), printedTotal: plainText(x.printed_total ?? x.set_total ?? set.printedTotal ?? set.total ?? ''), rarity: plainText(x.rarity ?? 'Unknown'), type: plainText(x.card_type ?? x.types?.[0] ?? x.supertype ?? 'Pokémon'), hp: plainText(x.hp), stage: plainText(x.stage ?? x.subtypes?.join(' · ')), text: plainText(x.card_text ?? x.flavorText ?? x.rules?.join(' ')), attacks, weakness: plainText(x.weakness ?? x.weaknesses?.map((item: any) => `${item.type} ${item.value}`).join(', ')), evolvesFrom: plainText(x.evolves_from ?? x.evolvesFrom ?? x.evolution_from), resistance: plainText(x.resistance ?? x.resistances?.map((item: any) => `${item.type} ${item.value}`).join(', ')), retreatCost: plainText(Array.isArray(retreat) ? retreat.join(', ') : retreat), illustrator: plainText(x.illustrator ?? x.artist), regulationMark: plainText(x.regulation_mark ?? x.regulationMark), abilities, imageUrl, prices: prices(raw), confidence: Math.max(.55, .96 - i * .08) };
}
export async function searchCards(query: string): Promise<Card[]> {
  assertConfigured();
  if (!query.trim()) throw new Error('No searchable card text was detected.');
  const res = await fetch(endpoint(`/search?q=${encodeURIComponent(query)}&limit=12`), { headers: headers() });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'PokéWallet rejected the API key.' : res.status === 429 ? 'Search limit reached. Try again shortly.' : `PokéWallet search failed (${res.status}).`);
  const json = await res.json(); return (json.results ?? []).map(mapCard);
}
export type CardEvidenceScore = { card:Card;score:number;signals:string[] };

const normalized = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
const STOP_WORDS = new Set(['pokemon','basic','stage','damage','during','this','that','from','your','with','when','then','card','cards','attack','energy','each','into','does','more']);
const evidenceWords = (value?: string) => new Set((value?.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(word => !STOP_WORDS.has(word)));

/** Point-based identity score. API result order and artwork never add points. */
export function scoreCardEvidence(card:Card,hints:ScanHints):CardEvidenceScore {
  let score=0;const signals:string[]=[];
  const add=(points:number,signal:string)=>{score+=points;if(points>0)signals.push(signal);};
  const wantedNumber=normalized(hints.number?.split('/')[0]);
  const resultNumber=normalized(card.number.split('/')[0]);
  const wantedTotal=normalized(hints.collectorTotal??hints.number?.split('/')[1]);
  const resultTotal=normalized(card.printedTotal??card.number.split('/')[1]);
  const wantedSet=normalized(hints.setCode),resultSet=normalized(card.setCode);
  const wantedBottom=normalized(hints.bottomIdentifier);
  const exactSetNumber=Boolean(wantedSet&&wantedNumber&&wantedSet===resultSet&&wantedNumber===resultNumber);
  const exactFraction=Boolean(wantedNumber&&wantedTotal&&wantedNumber===resultNumber&&wantedTotal===resultTotal);
  const resultIdentifiers=[normalized(card.number),normalized(`${card.setCode}${card.number.split('/')[0]}`),normalized(`${card.setCode}${card.number}`)];

  if(wantedBottom){
    if(resultIdentifiers.includes(wantedBottom)||exactSetNumber||exactFraction)add(300,'bottom identifier');
    else add(-170,'bottom identifier conflict');
  }
  // A complete fraction is a set fingerprint. Shared attacks and rule text
  // must not overcome a direct collector-number or printed-total conflict.
  if(wantedNumber&&wantedTotal&&resultNumber&&resultTotal&&!exactFraction){
    if(wantedNumber!==resultNumber)add(-190,'collector number conflict');
    if(wantedTotal!==resultTotal)add(-120,'printed set total conflict');
  }
  if(exactSetNumber)add(180,'set + collector number');
  if(exactFraction)add(150,'full collector number');
  else if(wantedNumber&&wantedNumber===resultNumber)add(100,'collector number');
  else if(wantedNumber&&resultNumber)add(-110,'collector number conflict');
  if(wantedTotal&&resultTotal){
    add(wantedTotal===resultTotal?55:-45,wantedTotal===resultTotal?'printed set total':'printed set total conflict');
  }
  if(wantedSet&&resultSet)add(wantedSet===resultSet?85:-35,wantedSet===resultSet?'set code':'set code conflict');
  if(hints.setName&&card.setName){
    const setSimilarity=similarity(hints.setName,card.setName);
    if(setSimilarity>=.86)add(55,'set name');else if(setSimilarity<.45)add(-20,'set name conflict');
  }

  if(hints.name&&card.name){
    const nameSimilarity=similarity(hints.name,card.name);
    if(normalized(hints.name)===normalized(card.name))add(90,'exact name');
    else if(nameSimilarity>=.88)add(72,'name');
    else if(nameSimilarity>=.68)add(Math.round(nameSimilarity*55),'partial name');
    else add(-65,'name conflict');
  }
  if(hints.hp&&card.hp)add(hints.hp===card.hp?38:-45,hints.hp===card.hp?'HP':'HP conflict');
  if(hints.type&&card.type)add(normalized(card.type).includes(normalized(hints.type))?22:-10,'card type');
  if(hints.stage&&card.stage)add(normalized(card.stage).includes(normalized(hints.stage))?18:-8,'stage');
  if(hints.rarity&&card.rarity)add(normalized(card.rarity).includes(normalized(hints.rarity))?18:-6,'rarity');
  if(hints.regulationMark&&card.regulationMark)add(normalized(hints.regulationMark)===normalized(card.regulationMark)?22:-12,'regulation mark');

  const kind=normalized(card.type).includes('trainer')?'trainer':normalized(card.type).includes('energy')?'energy':'pokemon';
  if(hints.cardKind)add(hints.cardKind===kind?25:-30,'card category');
  const searchable=[card.rarity,card.setName,card.text,card.evolvesFrom,card.weakness,card.resistance,card.retreatCost,...(card.abilities??[]),...(card.attacks??[])].filter(Boolean).join(' ');
  const ocrWords=evidenceWords(hints.evidence),candidateWords=evidenceWords(searchable);
  const wordMatches=[...ocrWords].filter(word=>candidateWords.has(word)).length;
  if(wordMatches)add(Math.min(64,wordMatches*8),`${wordMatches} text clues`);
  const wantedNumbers=new Set(hints.numericEvidence??[]);
  const candidateNumbers=new Set((searchable.match(/\b\d{1,3}\b/g)??[]).map(value=>value.replace(/^0+/,'')||'0'));
  const numberMatches=[...wantedNumbers].filter(value=>candidateNumbers.has(value)).length;
  if(numberMatches)add(Math.min(60,numberMatches*15),`${numberMatches} attack/damage values`);
  return {card,score,signals};
}

export function rankCards(cards: Card[], hints: ScanHints): Card[] {
  const scored=cards.map(card=>scoreCardEvidence(card,hints)).sort((a,b)=>b.score-a.score);
  const bestScore=scored[0]?.score??0;
  const secondScore=scored[1]?.score??0;
  return scored.filter(item=>item.score>=Math.max(35,bestScore-110)).slice(0,5).map(({card,score},index)=>{
    const margin=index===0?Math.max(0,score-secondScore):Math.max(0,score-(scored[index+1]?.score??0));
    const evidenceConfidence=.42+Math.max(0,score)/850+Math.min(.14,margin/500);
    return {...card,confidence:Math.max(.45,Math.min(.99,evidenceConfidence-index*.025))};
  });
}
export async function getCard(id: string): Promise<Card> {
  assertConfigured();
  const res = await fetch(endpoint(`/cards/${encodeURIComponent(id)}`), { headers: headers() });
  if (!res.ok) throw new Error(`Could not load card (${res.status}).`); return mapCard(await res.json());
}
export function cardImageSource(card: Card) { return key && !proxy ? { uri: card.imageUrl, headers: headers() } : { uri: card.imageUrl }; }
