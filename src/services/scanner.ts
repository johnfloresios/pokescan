import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { PhotoRecognizer } from 'react-native-vision-camera-ocr-plus';
import { extractCardFields } from './card-matcher';

type TextBox = { text: string; x: number; y: number; width: number; height: number };
type CardBounds = { x: number; y: number; width: number; height: number };
export type ScanHints = {
  name?: string; number?: string; setCode?: string; setName?: string;
  rarity?: string; hp?: string; type?: string; stage?: string; evidence?: string;
  collectorTotal?: string; numericEvidence?: string[]; bottomIdentifier?: string;
};
export type ScanText = { text: string; lines: string[]; query: string; queries: string[]; hints: ScanHints; cardDetected: boolean; ready: boolean };
const VisionRecognizer = requireOptionalNativeModule<{ recognize(path: string): Promise<{ text: string; bottomText?: string; boxes?: TextBox[]; cardDetected?: boolean; cardBounds?: CardBounds }> }>('CardTextRecognizer');

const normalizeCardLine = (line: string) => {
  let value = line.replace(/\s+/g, ' ').trim();

  // Full-art card fonts commonly make the final "x" in "ex" look like an
  // "a", "c", multiplication sign, or two separate letters to OCR.
  value = value.replace(/\b(?:ea|cx|e[×a])\b(?=\s*(?:hp\s*\d+)?$)/i, 'ex');
  value = value.replace(/\bE\s+X\b(?=\s*(?:HP\s*\d+)?$)/i, 'ex');

  // Collector numbers are a strong identifier. Repair common OCR glyph
  // substitutions only when they appear on both sides of a slash.
  value = value.replace(/\b([0-9OIlBS]{1,3})\s*[/|\\]\s*([0-9OIlBS]{1,3})\b/g, (_, left, right) => {
    const digits = (part: string) => part.replace(/[O]/gi, '0').replace(/[Il]/g, '1').replace(/B/gi, '8').replace(/S/gi, '5');
    return `${digits(left)}/${digits(right)}`;
  });
  // ML Kit sometimes drops a faint slash entirely. Only repair lines made of
  // two collector-sized groups so ordinary attack values are never changed.
  value = value.replace(/^(?:no\.?\s*|#\s*)?([0-9OIlBS]{2,3})\s+([0-9OIlBS]{2,3})(?:\s+[A-Z]{1,4})?$/i, (_, left, right) => {
    const digits = (part: string) => part.replace(/[O]/gi, '0').replace(/[Il]/g, '1').replace(/B/gi, '8').replace(/S/gi, '5');
    return `${digits(left)}/${digits(right)}`;
  });
  value = value.replace(/^([0-9]{6})$/, (_, number) => `${number.slice(0, 3)}/${number.slice(3)}`);
  return value;
};

const buildSearch = (lines: string[], boxes: TextBox[] = [], cardBounds?: CardBounds, allowStandaloneSerial = true, preferredBottomText = '') => {
  const clean = lines.map(normalizeCardLine).filter(Boolean);
  const preferredBottom = preferredBottomText.split(/\r?\n/).map(normalizeCardLine).filter(Boolean);
  const normalizedBoxes = boxes.map(box => ({ ...box, text: normalizeCardLine(box.text) })).filter(box => box.text);
  const minY = normalizedBoxes.length ? Math.min(...normalizedBoxes.map(box => box.y)) : 0;
  const maxY = normalizedBoxes.length ? Math.max(...normalizedBoxes.map(box => box.y + box.height)) : 1;
  const verticalSpan = Math.max(.01, maxY - minY);
  const relativeY = (box: TextBox) => (box.y - minY) / verticalSpan;
  // Vision coordinates start at the lower-left. When a rectangle is known,
  // use the physical card bands rather than relative OCR extents; relative
  // extents can incorrectly promote an attack when the real title is blurry.
  const cardRelativeY = (box: TextBox) => cardBounds ? (box.y - cardBounds.y) / Math.max(.01, cardBounds.height) : relativeY(box);
  const topThreshold = cardBounds ? .58 : .62;
  const bottomThreshold = cardBounds ? .36 : .38;
  const topLines = normalizedBoxes.filter(box => cardRelativeY(box) >= topThreshold).sort((a, b) => b.y - a.y || a.x - b.x).map(box => box.text);
  const spatialBottomLines = normalizedBoxes.filter(box => cardRelativeY(box) <= bottomThreshold).sort((a, b) => b.y - a.y || a.x - b.x).map(box => box.text);
  const bottomLines = [...preferredBottom, ...(spatialBottomLines.length ? spatialBottomLines : clean.slice(Math.max(1, Math.floor(clean.length * 0.55))))];

  const fractionLine = [...bottomLines, ...clean].find(x => /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(x));
  const fraction = fractionLine?.match(/\d{1,3}\s*\/\s*\d{1,3}/)?.[0];
  // Header labels are frequently returned as partial words (for example
  // "BAS" from BASIC). Never allow those fragments to become a card name.
  const ignored = /^(?:bas(?:i|1|l)?(?:c)?|sta(?:g(?:e)?)?\s*\d*|evo(?:lves?)?\s*(?:from)?|trainer|item|supporter|energy|ability|weakness|resistance|retreat|hp\s*\d+|illus\.?|no\.?|©)(?:\b|$)/i;
  const titleFromLine = (line: string) => line
    .replace(/^(?:BASIC|STAGE\s*\d*)\s+/i, '')
    .replace(/\bHP\s*\d{2,3}\b/ig, '')
    .replace(/\b\d{2,3}\s*HP\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizeName = (value: string) => value
    .replace(/[|]/g, 'I')
    .replace(/\b(?:ea|cx|e[×a])\b$/i, 'ex')
    .replace(/\bE\s+X\b$/i, 'ex')
    .replace(/\s*[-–—]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const validName = (value: string) => {
    const letters = value.replace(/[^A-Za-zÀ-ÿ]/g, '');
    const suspiciousHeaderCode = letters.length <= 6 && letters === letters.toUpperCase();
    return /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .:'’\-]{2,32}$/.test(value)
      && !ignored.test(value)
      && !suspiciousHeaderCode
      && value.split(/\s+/).length <= 4;
  };
  const spatialName = topLines.map(titleFromLine).map(normalizeName).find(validName);
  // Live OCR is returned in reading order. If spatial boxes are unavailable,
  // inspect only the first quarter of lines so attacks can never become names.
  const headerLines = clean.slice(0, Math.max(2, Math.ceil(clean.length * .25)));
  const name = spatialName ?? (!cardBounds ? headerLines.map(titleFromLine).map(normalizeName).find(validName) : undefined);

  // On some full-art cards Vision sees only the card's unique number ("196")
  // rather than the entire printed fraction ("196/165"). Collector numbers
  // are printed near the bottom, so only consider standalone values late in
  // the OCR order and reject values labeled as HP, damage, weakness, or rules.
  const serialLines = cardBounds
    ? normalizedBoxes.filter(box => cardRelativeY(box) <= .18).sort((a, b) => b.y - a.y || a.x - b.x).map(box => box.text)
    : [];
  const serial = [...serialLines].reverse().map(line => {
    if (/\b(?:hp|damage|weakness|resistance|retreat|rule)\b/i.test(line)) return undefined;
    return line.match(/^(?:no\.?\s*|#\s*)?(\d{2,3})(?:\s*[A-Z]{1,3})?$/i)?.[1];
  }).find(Boolean);

  const number = fraction ?? (allowStandaloneSerial ? serial : undefined);
  const collectorTotal = fraction?.split('/')[1]?.replace(/^0+/, '') || undefined;
  const excludedCodes = new Set(['HP', 'EX', 'GX', 'V', 'VMAX', 'VSTAR', 'BASIC', 'STAGE', 'ABILITY']);
  const setCode = [...bottomLines].reverse().map(line => {
    const match = line.match(/^(?:EN\s+)?([A-Z]{2,6}[0-9]{0,2})(?:\s+EN)?$/)?.[1];
    return match && !excludedCodes.has(match) ? match : undefined;
  }).find(Boolean);
  const compactIdentifier = bottomLines.map(line => line.toUpperCase().replace(/[^A-Z0-9/]/g, '')).find(line => /^(?:[A-Z]{2,6}\d{1,3}|[A-Z]{2,6}\d{1,3}\/\d{1,3})$/.test(line));
  const splitIdentifier = bottomLines.map(line => line.toUpperCase().match(/\b([A-Z]{2,6})\s*[- ]\s*(\d{1,3}(?:\s*\/\s*\d{1,3})?)\b/)).find(Boolean);
  const bottomIdentifier = compactIdentifier ?? (splitIdentifier ? `${splitIdentifier[1]}${splitIdentifier[2].replace(/\s/g, '')}` : fraction);
  const resolvedNumber = number ?? splitIdentifier?.[2]?.replace(/\s/g, '');
  const resolvedSetCode = (setCode && !/\d/.test(setCode)) ? setCode : splitIdentifier?.[1];

  const hp = clean.map(line => line.match(/\bHP\s*([0-9OIl]{2,3})\b/i)?.[1])
    .find(Boolean)?.replace(/O/gi, '0').replace(/[Il]/g, '1');
  const stage = clean.map(line => line.match(/\b(BASIC|STAGE\s*[12]|VMAX|VSTAR|MEGA)\b/i)?.[1])
    .find(Boolean)?.replace(/\s+/g, ' ').toUpperCase();
  const energyTypes = ['Colorless', 'Darkness', 'Dragon', 'Fairy', 'Fighting', 'Fire', 'Grass', 'Lightning', 'Metal', 'Psychic', 'Water'];
  const type = energyTypes.find(candidate => clean.some(line => new RegExp(`^(?:TYPE\\s*)?${candidate}$`, 'i').test(line)));
  const rarity = clean.map(line => line.match(/\b(AMAZING RARE|COMMON|UNCOMMON|RARE(?:\s+(?:HOLO|SECRET|RAINBOW|ULTRA|SHINY|PROMO))?)\b/i)?.[1])
    .find(Boolean)?.replace(/\b\w/g, character => character.toUpperCase());
  const knownSets = [
    'Scarlet & Violet', 'Sword & Shield', 'Sun & Moon', 'Paldea Evolved', 'Obsidian Flames',
    'Temporal Forces', 'Twilight Masquerade', 'Surging Sparks', 'Journey Together',
    'Destined Rivals', 'Prismatic Evolutions', 'Crown Zenith', 'Lost Origin',
  ];
  const setName = knownSets.find(candidate => clean.some(line => line.toLowerCase().includes(candidate.toLowerCase())));
  const numericEvidence = [...new Set(clean.flatMap(line => [...line.matchAll(/\b(\d{1,3})(?=\s*(?:[+x×]|damage|$))/gi)].map(match => match[1].replace(/^0+/, '') || '0'))
    .filter(value => Number(value) >= 10 && Number(value) <= 400 && value !== hp && value !== number?.split('/')[0].replace(/^0+/, '') && value !== collectorTotal))];
  const textFallback = extractCardFields(clean.join('\n'));
  const resolvedName = name ?? textFallback.name;
  const resolvedHp = hp ?? textFallback.hp;
  const resolvedType = type ?? textFallback.type;
  const resolvedStage = stage ?? textFallback.stage;
  const resolvedRarity = rarity ?? textFallback.rarity;

  const candidates = [
    [bottomIdentifier],
    [resolvedSetCode, resolvedNumber?.split('/')[0]],
    [resolvedName, resolvedNumber, resolvedSetCode || setName],
    [resolvedName, resolvedNumber],
    [resolvedName, resolvedSetCode || setName],
    [resolvedNumber, resolvedSetCode || setName],
    [resolvedName, resolvedHp],
    [resolvedName],
    [resolvedNumber],
  ].map(parts => parts.filter(Boolean).join(' ')).filter(Boolean);
  const queries = [...new Set(candidates)];
  return { query: queries[0] ?? '', queries, hints: { name: resolvedName, number: resolvedNumber, collectorTotal, bottomIdentifier, numericEvidence, setCode: resolvedSetCode, setName, rarity: resolvedRarity, hp: resolvedHp, type: resolvedType, stage: resolvedStage, evidence: clean.join(' ') } };
};

export function analyzeLiveText(rawText: string): ScanText {
  const text = rawText.trim();
  const lines = text.split(/\r?\n/).map(normalizeCardLine).filter(Boolean);
  // A bare value such as "20" is usually attack damage. Live capture requires
  // the printed collector fraction; high-resolution still OCR may use spatial
  // position to safely recover a standalone serial.
  const search = buildSearch(lines, [], undefined, false);
  return {
    text,
    lines,
    ...search,
    cardDetected: lines.length >= 4,
    ready: Boolean(search.hints.name && search.hints.number) && lines.length >= 4,
  };
}

export async function recognizeCard(uri: string): Promise<ScanText> {
  if (Platform.OS !== 'ios') {
    throw new Error('Camera text recognition is currently available on iOS only.');
  }
  let recognizedText = '';
  let boxes: TextBox[] = [];
  let cardDetected = false;
  let cardBounds: CardBounds | undefined;
  let bottomText = '';
  if (VisionRecognizer) {
    try {
      const result = await VisionRecognizer.recognize(uri.replace('file://', ''));
      recognizedText = result.text;
      boxes = result.boxes ?? [];
      cardDetected = result.cardDetected === true;
      cardBounds = result.cardBounds;
      bottomText = result.bottomText ?? '';
    } catch { /* use ML Kit still-image OCR below */ }
  }
  if (!recognizedText.trim()) {
    const result = await PhotoRecognizer({ uri, orientation: 'portrait' });
    recognizedText = result.resultText;
  }
  const text = String(recognizedText ?? '').trim();
  const lines = text.split(/\r?\n/).map(normalizeCardLine).filter(Boolean);
  const search = buildSearch(lines, boxes, cardBounds, true, bottomText);

  if (!text || !search.query) {
    throw new Error('No card name or collector number was detected. Move closer, avoid glare, and try again.');
  }
  return {
    text,
    lines,
    ...search,
    cardDetected,
    // Name + collector number is the authoritative capture gate. Rectangle
    // detection strengthens confidence, while a sufficiently rich OCR frame
    // permits cards whose foil, sleeve, or border hides one or more edges.
    ready: Boolean(search.hints.name && search.hints.number) && (cardDetected || lines.length >= 4),
  };
}
