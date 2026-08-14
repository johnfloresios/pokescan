import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type ScanText = { text: string; lines: string[]; query: string };
const VisionRecognizer = requireOptionalNativeModule<{ recognize(path: string): Promise<{ text: string }> }>('CardTextRecognizer');

const buildQuery = (lines: string[]) => {
  const clean = lines.map(x => x.trim()).filter(Boolean);
  const number = clean.find(x => /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(x));
  const ignored = /^(basic|stage|trainer|item|supporter|energy|hp\s*\d+)/i;
  const name = clean.find(x => /^[A-Za-z][A-Za-z .'-]{2,25}$/.test(x) && !ignored.test(x));
  return [name, number?.match(/\d{1,3}\s*\/\s*\d{1,3}/)?.[0]].filter(Boolean).join(' ');
};

export async function recognizeCard(uri: string): Promise<ScanText> {
  if (Platform.OS === 'ios' && VisionRecognizer) {
    const result = await VisionRecognizer.recognize(uri.replace('file://', ''));
    const lines = String(result.text ?? '').split(/\r?\n/).filter(Boolean);
    return { text: result.text, lines, query: buildQuery(lines) };
  }
  // Expo Go / simulator preview. A dev build on iOS uses Apple Vision above.
  const lines = ['Pikachu ex', 'HP 190', '063/193', 'Paldea Evolved'];
  return { text: lines.join('\n'), lines, query: buildQuery(lines) };
}
