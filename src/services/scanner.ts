import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { PhotoRecognizer } from 'react-native-vision-camera-ocr-plus';
import { extractCardFields } from './card-matcher';

type TextBox = { text: string; x: number; y: number; width: number; height: number };
type CardBounds = { x: number; y: number; width: number; height: number };
export type ScanHints = {
  name?: string; number?: string; setCode?: string; setId?: string; setName?: string;
  rarity?: string; hp?: string; type?: string; stage?: string; evidence?: string;
  collectorTotal?: string; numericEvidence?: string[]; bottomIdentifier?: string;
  cardKind?: 'pokemon'|'trainer'|'energy'; regulationMark?: string;
};
export type ScanText = { text: string; lines: string[]; query: string; queries: string[]; hints: ScanHints; cardDetected: boolean; ready: boolean };
const VisionRecognizer = requireOptionalNativeModule<{ recognize(path: string): Promise<{ text: string; bottomText?: string; boxes?: TextBox[]; cardDetected?: boolean; cardBounds?: CardBounds }> }>('CardTextRecognizer');

export function scanCompleteness(scan:ScanText){
  let score=Math.min(30,scan.lines.length*2);
  if(scan.hints.name)score+=55;
  if(scan.hints.number)score+=90;
  if(scan.hints.number?.includes('/'))score+=75;
  if(scan.hints.collectorTotal)score+=35;
  if(scan.hints.setCode)score+=65;
  if(scan.hints.bottomIdentifier)score+=85;
  if(scan.hints.hp)score+=12;
  if(scan.hints.cardKind)score+=8;
  if(scan.cardDetected)score+=25;
  return score;
}

const NON_NAMES=/^(?:stage\s*(?:[iIlL12]|one|two)?|basic|evolves?\s*from|trainer|item|supporter|stadium|ability|energy|weakness|resistance|retreat|rule|card|hp|no\.?|illus(?:trator)?\.?)$/i;
const plausibleCardName=(value?:string)=>{
  const clean=value?.replace(/\s+/g,' ').trim()??'';
  const letters=clean.replace(/[^A-Za-zÀ-ÿ]/g,'');
  return letters.length>=3&&letters.length<=32&&!NON_NAMES.test(clean)&&!/^(?:stage|basic|hp|trainer|ability)\b/i.test(clean)&&/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .:'’&\-]{2,40}$/.test(clean);
};

const cleanQueryPart=(value?:string)=>value?.replace(/\s+/g,' ').trim()||'';
function queriesFromHints(hints:ScanHints){
  const name=cleanQueryPart(hints.name),setCode=cleanQueryPart(hints.setCode),number=cleanQueryPart(hints.number);
  return [...new Set([
    hints.setId&&number?`${hints.setId} ${number.split('/')[0]}`:'',
    setCode&&number?`${setCode} ${number}`:'',
    name&&setCode?`${name} ${setCode}`:'',
    name&&number?`${name} ${number}`:'',
    name,
  ].filter(Boolean))];
}

/** Selects the strongest still and fills only missing clues from other frames. */
export function mergeFrameScans(scans:readonly ScanText[]):ScanText{
  if(!scans.length)throw new Error('No scan frames were available.');
  const ranked=[...scans].sort((a,b)=>scanCompleteness(b)-scanCompleteness(a));
  const best=ranked[0];
  const hints:{[K in keyof ScanHints]?:ScanHints[K]}={...best.hints};
  const consensus=<K extends keyof ScanHints>(field:K,valid:(value:string)=>boolean)=>{
    const groups=new Map<string,{value:string;count:number;quality:number}>();
    for(const scan of ranked){
      const raw=scan.hints[field];if(typeof raw!=='string'||!valid(raw))continue;
      const value=raw.replace(/\s+/g,' ').trim();const key=value.toLowerCase().replace(/[^a-z0-9/]/g,'');
      const current=groups.get(key);const quality=scanCompleteness(scan);
      groups.set(key,current?{...current,count:current.count+1,quality:Math.max(current.quality,quality)}:{value,count:1,quality});
    }
    return [...groups.values()].sort((a,b)=>(b.count*240+b.quality)-(a.count*240+a.quality))[0]?.value;
  };
  hints.name=consensus('name',plausibleCardName);
  hints.number=consensus('number',value=>/^\d{1,3}(?:\/\d{1,3})?$/.test(value.replace(/\s/g,'')))?.replace(/\s/g,'');
  hints.setCode=consensus('setCode',value=>/^[A-Za-z]{1,6}\d{0,3}[A-Za-z]?$/.test(value)&&!NON_NAMES.test(value));
  const fields:(keyof ScanHints)[]=['collectorTotal','bottomIdentifier','setId','setName','rarity','hp','type','stage','cardKind','regulationMark'];
  for(const field of fields){
    if(hints[field])continue;
    const candidate=ranked.find(scan=>scan.hints[field]);
    if(candidate)(hints as Record<string,unknown>)[field]=candidate.hints[field];
  }
  if(hints.number?.includes('/'))hints.collectorTotal=hints.number.split('/')[1]?.replace(/^0+/,'')||undefined;
  if(hints.number)hints.bottomIdentifier=hints.setCode?`${hints.setCode} ${hints.number}`:hints.number;
  hints.numericEvidence=[...new Set(ranked.flatMap(scan=>scan.hints.numericEvidence??[]))];
  hints.evidence=ranked.map(scan=>scan.hints.evidence).filter(Boolean).join(' ');
  const queries=queriesFromHints(hints as ScanHints);
  return {...best,text:ranked.map(scan=>scan.text).join('\n'),lines:[...new Set(ranked.flatMap(scan=>scan.lines))],hints:hints as ScanHints,query:queries[0]??best.query,queries:[...new Set([...queries,...ranked.flatMap(scan=>scan.queries)])],cardDetected:ranked.some(scan=>scan.cardDetected),ready:Boolean(hints.name&&hints.number)};
}

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
  const ignored = /^(?:bas(?:i|1|l)?(?:c)?|sta(?:g(?:e)?)?\s*(?:\d|[iIlL])?|evo(?:lves?)?\s*(?:from)?|trainer|item|supporter|stadium|special energy|basic energy|ability|weakness|resistance|retreat|hp\s*\d+|illus\.?|no\.?|©)$/i;
  const titleFromLine = (line: string) => line
    .replace(/^(?:BASIC|STAGE\s*(?:\d|[iIlL])?)\s+/i, '')
    .replace(/^(?:TRAINER|ITEM|SUPPORTER|STADIUM)\s*[-:·]?\s+/i, '')
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
    return plausibleCardName(value)
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
  const excludedCodes = new Set(['HP', 'EX', 'GX', 'V', 'VMAX', 'VSTAR', 'BASIC', 'STAGE', 'ABILITY', 'TRAINER', 'ITEM', 'ILLUS', 'G', 'H', 'I']);
  const alphabeticSetCodes = new Set(['SVI','PAL','OBF','MEW','PAR','PAF','TEF','TWM','SFA','SCR','SSP','PRE','JTG','DRI']);
  const setCode = [...bottomLines].reverse().map(line => {
    const match = line.match(/^(?:EN\s+)?([A-Z]{1,6}[0-9]{0,3}[A-Z]?)(?:\s+EN)?$/i)?.[1];
    const upper=match?.toUpperCase();
    return match && upper && !excludedCodes.has(upper) && (/\d/.test(match)||alphabeticSetCodes.has(upper)) ? match : undefined;
  }).find(Boolean);
  const promoIdentifier = bottomLines.map(line => line.toUpperCase().replace(/[^A-Z0-9]/g, '')).find(line => /^(?:DP|SWSH|SM|XY|BW|HGSS)\d{1,3}$/.test(line));
  const identifierMatch = bottomLines.map(line => normalizeCardLine(line).match(/\b([A-Z]{1,6}\d{0,3}[A-Z]?)\s+[- ]?\s*(\d{1,3}(?:\s*\/\s*\d{1,3})?)\b/i)).find(Boolean);
  const compactIdentifier = identifierMatch ? `${identifierMatch[1]} ${identifierMatch[2].replace(/\s/g, '')}` : undefined;
  const bottomIdentifier = promoIdentifier ?? compactIdentifier ?? fraction;
  const promoParts = promoIdentifier?.match(/^([A-Z]+)(\d+)$/);
  const resolvedNumber = fraction ?? identifierMatch?.[2]?.replace(/\s/g, '') ?? promoParts?.[2] ?? number;
  const resolvedSetCode = identifierMatch?.[1] ?? promoParts?.[1] ?? setCode;
  const setId = bottomLines.map(line => line.match(/\bset\s*(?:id)?\s*[:#-]?\s*(\d{4,8})\b/i)?.[1]).find(Boolean);
  const regulationMark = bottomLines.map(line => line.match(/^(?:REGULATION\s*)?([GHI])$/i)?.[1]?.toUpperCase()).find(Boolean);

  const joined=clean.join(' ');
  const cardKind:ScanHints['cardKind'] = /\b(?:TRAINER|ITEM|SUPPORTER|STADIUM|TRAINER RULE|ITEM RULE|SUPPORTER RULE)\b/i.test(joined)
    ? 'trainer'
    : /\b(?:BASIC|SPECIAL)\s+ENERGY\b|\bENERGY\s+CARD\b/i.test(joined)
      ? 'energy'
      : 'pokemon';

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
  const resolvedName = [name,textFallback.name].find(plausibleCardName);
  const resolvedHp = hp ?? textFallback.hp;
  const resolvedType = type ?? textFallback.type;
  const resolvedStage = stage ?? textFallback.stage;
  const resolvedRarity = rarity ?? textFallback.rarity;

  const candidates = [
    setId && resolvedNumber ? `${setId} ${resolvedNumber.split('/')[0]}` : '',
    promoIdentifier ?? '',
    cardKind!=='pokemon' && resolvedName && resolvedSetCode && resolvedNumber ? `${resolvedName} ${resolvedSetCode} ${resolvedNumber}` : '',
    resolvedSetCode && resolvedNumber ? `${resolvedSetCode} ${resolvedNumber}` : '',
    resolvedName && resolvedSetCode ? `${resolvedName} ${resolvedSetCode}` : '',
    resolvedName && resolvedNumber ? `${resolvedName} ${resolvedNumber}` : '',
    resolvedName ?? '',
  ].filter(Boolean);
  const queries = [...new Set(candidates)];
  return { query: queries[0] ?? '', queries, hints: { name: resolvedName, number: resolvedNumber, collectorTotal, bottomIdentifier, numericEvidence, setCode: resolvedSetCode, setId, setName, rarity: resolvedRarity, hp: cardKind==='pokemon'?resolvedHp:undefined, type: resolvedType, stage: cardKind==='pokemon'?resolvedStage:undefined, cardKind, regulationMark, evidence: joined } };
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

  // Keep partial frames (for example, one with a sharp title but a washed-out
  // bottom strip). The burst merger can combine their non-conflicting clues.
  if (!text) throw new Error('No card text was detected. Move closer, avoid glare, and try again.');
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

/** OCRs burst photos sequentially to keep peak memory low on older iPhones. */
export async function recognizeBestCard(uris:readonly string[]):Promise<ScanText>{
  const scans:ScanText[]=[];
  let lastError:unknown;
  const deadline=Date.now()+6000;
  for(const uri of uris.slice(0,3)){
    const remaining=deadline-Date.now();
    if(remaining<=150)break;
    try{
      const scan=await Promise.race<ScanText>([
        recognizeCard(uri),
        new Promise<ScanText>((_resolve,reject)=>setTimeout(()=>reject(new Error('OCR frame timed out.')),Math.min(3000,remaining))),
      ]);
      scans.push(scan);
      // A complete bottom identifier and title is authoritative; avoid doing
      // more expensive section passes when one still already has everything.
      if(scan.hints.name&&scan.hints.setCode&&scan.hints.number&&scan.hints.bottomIdentifier)break;
    }
    catch(error){lastError=error;}
  }
  if(!scans.length)throw lastError instanceof Error?lastError:new Error('No readable card text was detected.');
  // Partial results intentionally survive: the confirmation screen lets the
  // user correct a title, set code, or number instead of restarting forever.
  return mergeFrameScans(scans);
}
