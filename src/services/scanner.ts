import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type ScanText = { text: string; lines: string[]; query: string };
const VisionRecognizer = requireOptionalNativeModule<{ recognize(path: string): Promise<{ text: string }> }>('CardTextRecognizer');

const buildQuery = (lines: string[]) => {
  const clean = lines.map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const number = clean.find(x => /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(x));
  const ignored = /^(basic|stage\s*\d*|trainer|item|supporter|energy|ability|weakness|resistance|retreat|hp\s*\d+|illus\.|©)/i;
  const name = clean.find(x => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .:'’\-]{2,32}$/.test(x) && !ignored.test(x));
  return [name, number?.match(/\d{1,3}\s*\/\s*\d{1,3}/)?.[0]].filter(Boolean).join(' ');
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
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const query = buildQuery(lines);

  if (!text || !query) {
    throw new Error('No card name or collector number was detected. Move closer, avoid glare, and try again.');
  }
  return { text, lines, query };
}
