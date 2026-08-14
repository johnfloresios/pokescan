import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type TextBox = { text: string; x: number; y: number; width: number; height: number };
type CardBounds = { x: number; y: number; width: number; height: number };
export type ScanHints = { name?: string; number?: string; setCode?: string; hp?: string; evidence?: string };
export type ScanText = { text: string; lines: string[]; query: string; queries: string[]; hints: ScanHints; cardDetected: boolean; ready: boolean };
const VisionRecognizer = requireOptionalNativeModule<{ recognize(path: string): Promise<{ text: string; boxes?: TextBox[]; cardDetected?: boolean; cardBounds?: CardBounds }> }>('CardTextRecognizer');

const normalizeCardLine = (line: string) => {
  let value = line.replace(/\s+/g, ' ').trim();

  // Full-art card fonts commonly make the final "x" in "ex" look like an
  // "a", "c", multiplication sign, or two separate letters to OCR.
  value = value.replace(/\b(?:ea|cx|e[×a])\b(?=\s*(?:hp\s*\d+)?$)/i, 'ex');
  value = value.replace(/\bE\s+X\b(?=\s*(?:HP\s*\d+)?$)/i, 'ex');

  // Collector numbers are a strong identifier. Repair common OCR glyph
  // substitutions only when they appear on both sides of a slash.
  value = value.replace(/\b([0-9OIl]{1,3})\s*[/|]\s*([0-9OIl]{1,3})\b/g, (_, left, right) => {
    const digits = (part: string) => part.replace(/[O]/gi, '0').replace(/[Il]/g, '1');
    return `${digits(left)}/${digits(right)}`;
  });
  return value;
};

const buildSearch = (lines: string[], boxes: TextBox[] = [], cardBounds?: CardBounds) => {
  const clean = lines.map(normalizeCardLine).filter(Boolean);
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
  const bottomLines = spatialBottomLines.length ? spatialBottomLines : clean.slice(Math.max(1, Math.floor(clean.length * 0.55)));

  const fractionLine = [...bottomLines, ...clean].find(x => /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(x));
  const fraction = fractionLine?.match(/\d{1,3}\s*\/\s*\d{1,3}/)?.[0];
  const ignored = /^(basic|stage\s*\d*|evolves?\s+from|trainer|item|supporter|energy|ability|weakness|resistance|retreat|hp\s*\d+|illus\.|©)/i;
  const titleFromLine = (line: string) => line
    .replace(/^(?:BASIC|STAGE\s*\d*)\s+/i, '')
    .replace(/\bHP\s*\d{2,3}\b/ig, '')
    .replace(/\b\d{2,3}\s*HP\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  const validName = (value: string) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .:'’\-]{2,32}$/.test(value) && !ignored.test(value) && value.split(/\s+/).length <= 4;
  const spatialName = topLines.map(titleFromLine).find(validName);
  // Live OCR is returned in reading order. If spatial boxes are unavailable,
  // inspect only the first quarter of lines so attacks can never become names.
  const headerLines = clean.slice(0, Math.max(2, Math.ceil(clean.length * .25)));
  const name = spatialName ?? (!cardBounds ? headerLines.map(titleFromLine).find(validName) : undefined);

  // On some full-art cards Vision sees only the card's unique number ("196")
  // rather than the entire printed fraction ("196/165"). Collector numbers
  // are printed near the bottom, so only consider standalone values late in
  // the OCR order and reject values labeled as HP, damage, weakness, or rules.
  const serial = [...bottomLines].reverse().map(line => {
    if (/\b(?:hp|damage|weakness|resistance|retreat|rule)\b/i.test(line)) return undefined;
    return line.match(/^(?:no\.?\s*|#\s*)?(\d{2,3})(?:\s*[A-Z]{1,3})?$/i)?.[1];
  }).find(Boolean);

  const number = fraction ?? serial;
  const hp = clean.map(line => line.match(/\bHP\s*(\d{2,3})\b/i)?.[1]).find(Boolean);
  const excludedCodes = new Set(['HP', 'EX', 'GX', 'V', 'VMAX', 'VSTAR', 'BASIC', 'STAGE', 'ABILITY']);
  const setCode = [...bottomLines].reverse().map(line => {
    const match = line.match(/^(?:EN\s+)?([A-Z]{2,6}[0-9]{0,2})(?:\s+EN)?$/)?.[1];
    return match && !excludedCodes.has(match) ? match : undefined;
  }).find(Boolean);

  const candidates = [
    [name, number, setCode],
    [name, number],
    [number, setCode],
    [name, setCode],
    [name],
    [number],
  ].map(parts => parts.filter(Boolean).join(' ')).filter(Boolean);
  const queries = [...new Set(candidates)];
  return { query: queries[0] ?? '', queries, hints: { name, number, setCode, hp, evidence: clean.join(' ') } };
};

export function analyzeLiveText(rawText: string): ScanText {
  const text = rawText.trim();
  const lines = text.split(/\r?\n/).map(normalizeCardLine).filter(Boolean);
  const search = buildSearch(lines);
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
  if (!VisionRecognizer) {
    throw new Error('Real scanning requires the pokeScan development build. Apple Vision is not available in Expo Go.');
  }

  const result = await VisionRecognizer.recognize(uri.replace('file://', ''));
  const text = String(result.text ?? '').trim();
  const lines = text.split(/\r?\n/).map(normalizeCardLine).filter(Boolean);
  const search = buildSearch(lines, result.boxes, result.cardBounds);

  if (!text || !search.query) {
    throw new Error('No card name or collector number was detected. Move closer, avoid glare, and try again.');
  }
  return {
    text,
    lines,
    ...search,
    cardDetected: result.cardDetected === true,
    // Name + collector number is the authoritative capture gate. Rectangle
    // detection strengthens confidence, while a sufficiently rich OCR frame
    // permits cards whose foil, sleeve, or border hides one or more edges.
    ready: Boolean(search.hints.name && search.hints.number) && (result.cardDetected === true || lines.length >= 4),
  };
}
