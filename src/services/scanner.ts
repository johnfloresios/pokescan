import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type ScanHints = { name?: string; number?: string; setCode?: string; hp?: string };
export type ScanText = { text: string; lines: string[]; query: string; queries: string[]; hints: ScanHints };
const VisionRecognizer = requireOptionalNativeModule<{ recognize(path: string): Promise<{ text: string }> }>('CardTextRecognizer');

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

const buildSearch = (lines: string[]) => {
  const clean = lines.map(normalizeCardLine).filter(Boolean);
  const fractionLine = clean.find(x => /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(x));
  const fraction = fractionLine?.match(/\d{1,3}\s*\/\s*\d{1,3}/)?.[0];
  const ignored = /^(basic|stage\s*\d*|trainer|item|supporter|energy|ability|weakness|resistance|retreat|hp\s*\d+|illus\.|©)/i;
  const name = clean.find(x => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .:'’\-]{2,32}$/.test(x) && !ignored.test(x));

  // On some full-art cards Vision sees only the card's unique number ("196")
  // rather than the entire printed fraction ("196/165"). Collector numbers
  // are printed near the bottom, so only consider standalone values late in
  // the OCR order and reject values labeled as HP, damage, weakness, or rules.
  const bottomLines = clean.slice(Math.max(1, Math.floor(clean.length * 0.55)));
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
  return { query: queries[0] ?? '', queries, hints: { name, number, setCode, hp } };
};

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
  const search = buildSearch(lines);

  if (!text || !search.query) {
    throw new Error('No card name or collector number was detected. Move closer, avoid glare, and try again.');
  }
  return { text, lines, ...search };
}
