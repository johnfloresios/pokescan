/** Pure OCR parsing/ranking plus a small PokéWallet network orchestrator. */

export type MatchConfidence = 'high' | 'medium' | 'low';

export interface ExtractedCardFields {
  name?: string;
  cardNumber?: string;
  numberOnly?: string;
  hp?: string;
  setCode?: string;
  setName?: string;
  type?: string;
  stage?: string;
  rarity?: string;
  cleanedText: string;
  lines: string[];
}

export interface PokeWalletCardInfo {
  name?: string; clean_name?: string; set_name?: string; set_code?: string;
  set_id?: string | number; card_number?: string; rarity?: string; hp?: string;
  card_type?: string; stage?: string;
}

export interface PokeWalletSearchCard {
  id: string;
  card_info?: PokeWalletCardInfo;
  tcgplayer?: unknown;
  cardmarket?: unknown;
  [key: string]: unknown;
}

export interface RankedPokeWalletCard {
  card: PokeWalletSearchCard;
  score: number;
  confidence: MatchConfidence;
}

export interface CardMatchResult {
  bestMatch: RankedPokeWalletCard | null;
  topCandidates: RankedPokeWalletCard[];
  confidence: MatchConfidence;
  extractedFields: ExtractedCardFields;
  rawQuery: string;
  originalOCRText: string;
}

export interface MatchOptions {
  apiKey: string;
  baseUrl?: string;
  limit?: number;
  minimumScore?: number;
  fetchImpl?: typeof fetch;
  /** Spatial/native OCR fields take precedence over text-only guesses. */
  hints?: Partial<ExtractedCardFields>;
}

const TYPES = ['colorless', 'darkness', 'dragon', 'fairy', 'fighting', 'fire', 'grass', 'lightning', 'metal', 'psychic', 'water'];
const NAME_CORRECTIONS: Record<string, string> = {
  pikacnu: 'Pikachu', pikachu: 'Pikachu', charlizard: 'Charizard', charizard: 'Charizard',
  charlizardex: 'Charizard ex', mewtw0: 'Mewtwo', greninla: 'Greninja', sylve0n: 'Sylveon',
  umbre0n: 'Umbreon', gardevolr: 'Gardevoir', drag0nite: 'Dragonite', marecp: 'Mareep',
};

const normalize = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
const titleCase = (value: string) => value.replace(/\b\w/g, char => char.toUpperCase()).replace(/\bEx\b/g, 'ex');

export function cleanOCRText(raw: string): { cleanedText: string; lines: string[]; words: string[] } {
  const lines = raw.split(/\r?\n/).map(line => line
    .replace(/[“”]/g, '"').replace(/[’`]/g, "'").replace(/[•·]/g, ' ')
    .replace(/[^\p{L}\p{N}\s/'&.:'()#+×\-]/gu, ' ')
    .replace(/\s+/g, ' ').trim()).filter(Boolean);
  const cleanedText = lines.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
  return { cleanedText, lines, words: cleanedText.split(' ').filter(Boolean) };
}

export function levenshtein(a: string, b: string): number {
  const left = normalize(a), right = normalize(b);
  const row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[right.length];
}

export function similarity(a?: string, b?: string): number {
  const left = normalize(a), right = normalize(b);
  if (!left || !right) return 0;
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length);
}

function repairNumber(value: string): string {
  return value.replace(/O/gi, '0').replace(/[Il|]/g, '1').replace(/B/gi, '8').replace(/S/gi, '5').replace(/\\/g, '/');
}

export function extractCardFields(rawOCRText: string, hints: Partial<ExtractedCardFields> = {}): ExtractedCardFields {
  const clean = cleanOCRText(rawOCRText);
  const bottom = clean.lines.slice(Math.max(0, Math.floor(clean.lines.length * .55)));
  const fraction = [...bottom, ...clean.lines].map(repairNumber).map(line => line.match(/\b\d{1,3}\s*[/|]\s*\d{1,3}\b/)?.[0]).find(Boolean)?.replace(/\s/g, '').replace('|', '/');
  const standalone = bottom.map(repairNumber).map(line => line.match(/^(?:no\.?\s*|#\s*)?(\d{2,3})$/i)?.[1]).find(Boolean);
  const header = clean.lines.slice(0, Math.max(3, Math.ceil(clean.lines.length * .25)));
  const ignored = /^(?:bas(?:ic)?|sta(?:ge)?\s*\d*|evolves?|hp|trainer|energy|ability|weakness|resistance|retreat|illus)/i;
  const rawName = header.map(line => line.replace(/\bHP\s*[0-9OIl]{2,3}\b/ig, '').replace(/^(?:BASIC|STAGE\s*\d*)\s+/i, '').trim())
    .find(line => /^[A-Za-z][A-Za-z .:'’\-]{2,31}$/.test(line) && !ignored.test(line));
  const correctionKey = normalize(rawName);
  const name = hints.name ?? NAME_CORRECTIONS[correctionKey] ?? (rawName ? titleCase(rawName) : undefined);
  const hp = hints.hp ?? clean.lines.map(line => repairNumber(line).match(/\bHP\s*(\d{2,3})\b/i)?.[1]).find(Boolean);
  const setCode = hints.setCode ?? [...bottom].reverse().map(line => line.match(/^(?:EN\s+)?([A-Z]{2,6}\d{0,2})(?:\s+EN)?$/)?.[1]).find(code => code && !/^(?:HP|EX|GX|V|BASIC|STAGE)$/i.test(code));
  const type = hints.type ?? TYPES.find(item => clean.lines.some(line => normalize(line) === item));
  const stage = hints.stage ?? clean.cleanedText.match(/\b(basic|stage\s*[12]|vmax|vstar|mega)\b/i)?.[1];
  const rarity = hints.rarity ?? clean.cleanedText.match(/\b(amazing rare|common|uncommon|rare(?: holo| secret| rainbow| ultra| shiny)?)\b/i)?.[1];
  const cardNumber = hints.cardNumber ?? fraction ?? standalone;
  return {
    ...hints, name, cardNumber, numberOnly: hints.numberOnly ?? (cardNumber?.split('/')[0].replace(/^0+/, '') || undefined),
    hp, setCode, type: type ? titleCase(type) : undefined, stage: stage ? titleCase(stage) : undefined,
    rarity: rarity ? titleCase(rarity) : undefined, cleanedText: clean.cleanedText, lines: clean.lines,
  };
}

export function buildCascadingQueries(fields: ExtractedCardFields): string[] {
  const values = [
    [fields.name, fields.cardNumber], [fields.name, fields.numberOnly], [fields.name, fields.hp],
    [fields.setCode, fields.cardNumber], [fields.cardNumber], [fields.name],
    [fields.name?.split(/\s+/)[0]],
  ].map(parts => parts.filter(Boolean).join(' ').trim()).filter(Boolean);
  return [...new Set(values)];
}

export function scorePokeWalletCard(card: PokeWalletSearchCard, fields: ExtractedCardFields): number {
  const info = card.card_info ?? (card as PokeWalletCardInfo);
  let score = 0;
  const wantedNumber = normalize(fields.numberOnly ?? fields.cardNumber?.split('/')[0]);
  const resultNumber = normalize(info.card_number?.split('/')[0]);
  if (wantedNumber && resultNumber === wantedNumber) score += 100;
  score += Math.round(similarity(fields.name, info.clean_name ?? info.name) * 40);
  if (fields.hp && info.hp === fields.hp) score += 15;
  if (fields.setCode && similarity(fields.setCode, info.set_code) >= .8) score += 15;
  else if (fields.setName && similarity(fields.setName, info.set_name) >= .7) score += 10;
  if (fields.type && similarity(fields.type, info.card_type) >= .75) score += 10;
  if (fields.stage && similarity(fields.stage, info.stage) >= .75) score += 5;
  if (fields.rarity && similarity(fields.rarity, info.rarity) >= .7) score += 5;
  return score;
}

export const confidenceForScore = (score: number): MatchConfidence => score >= 135 ? 'high' : score >= 75 ? 'medium' : 'low';

export async function findBestPokeWalletMatch(originalOCRText: string, options: MatchOptions): Promise<CardMatchResult> {
  if (!options.apiKey.trim()) throw new Error('A PokéWallet API key is required.');
  const fields = extractCardFields(originalOCRText, options.hints);
  const queries = buildCascadingQueries(fields);
  const fetcher = options.fetchImpl ?? fetch;
  const found = new Map<string, PokeWalletSearchCard>();
  let rawQuery = '';
  for (const query of queries) {
    rawQuery = query;
    let response: Response;
    try {
      response = await fetcher(`${options.baseUrl ?? 'https://api.pokewallet.io'}/search?q=${encodeURIComponent(query)}&limit=${options.limit ?? 10}&page=1`, { headers: { 'X-API-Key': options.apiKey } });
    } catch { throw new Error('Could not reach PokéWallet. Check the network and try again.'); }
    if (response.status === 429) throw new Error('PokéWallet rate limit reached. Try again shortly.');
    if (!response.ok) throw new Error(`PokéWallet search failed (${response.status}).`);
    const payload = await response.json();
    for (const card of (payload.results ?? []) as PokeWalletSearchCard[]) found.set(card.id, card);
    const best = [...found.values()].reduce((max, card) => Math.max(max, scorePokeWalletCard(card, fields)), 0);
    if (best >= 135 || (best >= 100 && Boolean(fields.numberOnly))) break;
  }
  const topCandidates = [...found.values()].map(card => ({ card, score: scorePokeWalletCard(card, fields), confidence: confidenceForScore(scorePokeWalletCard(card, fields)) }))
    .filter(item => item.score >= (options.minimumScore ?? 35)).sort((a, b) => b.score - a.score).slice(0, 5);
  return { bestMatch: topCandidates[0] ?? null, topCandidates, confidence: topCandidates[0]?.confidence ?? 'low', extractedFields: fields, rawQuery, originalOCRText };
}
