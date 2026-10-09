export type Language =
  | 'English'
  | 'French'
  | 'German'
  | 'Italian'
  | 'Spanish'
  | 'Portuguese'
  | 'Japanese'
  | 'Korean'
  | 'Asian English'
  | 'Traditional Chinese'
  | 'Simplified Chinese'
  | 'Unknown';

export const LANGUAGES: Language[] = [
  'English',
  'French',
  'German',
  'Italian',
  'Spanish',
  'Portuguese',
  'Japanese',
  'Korean',
  'Asian English',
  'Traditional Chinese',
  'Simplified Chinese',
  'Unknown',
];

const REGION_LANGUAGE: Record<string, Language> = {
  '': 'English', E: 'English', EN: 'English',
  F: 'French', FR: 'French',
  G: 'German', DE: 'German',
  I: 'Italian', IT: 'Italian',
  S: 'Spanish', SP: 'Spanish',
  P: 'Portuguese', PT: 'Portuguese',
  JP: 'Japanese',
  K: 'Korean', KR: 'Korean',
  AE: 'Asian English',
  TC: 'Traditional Chinese',
  SC: 'Simplified Chinese',
};

export const CODE_PATTERN = /^[A-Z0-9]{2,5}-[A-Z]{0,2}[A-Z0-9]{3}$/;

// A code that is not glued to other letters or digits. No lookbehind: it breaks on older iOS.
const CODE_IN_TEXT = /(?:^|[^A-Z0-9])([A-Z0-9]{2,5}-[A-Z]{0,2}[A-Z0-9]{3})(?![A-Z0-9])/;

function clean(text: string): string {
  return text
    .toUpperCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, '-');
}

export function extract(text: string): string | null {
  const found = CODE_IN_TEXT.exec(clean(text));
  return found ? found[1] : null;
}

// Every code in the text, in reading order, each listed once.
export function extractAll(text: string): string[] {
  const pattern = new RegExp(CODE_IN_TEXT.source, 'g');
  const codes = new Set<string>();
  for (const found of clean(text).matchAll(pattern)) codes.add(found[1]);
  return [...codes];
}

export function parse(code: string): { prefix: string; region: string; number: string } {
  const hyphen = code.indexOf('-');
  const prefix = code.slice(0, hyphen);
  const rest = code.slice(hyphen + 1);
  return { prefix, region: rest.slice(0, -3), number: rest.slice(-3) };
}

export function languageOf(region: string): Language {
  return REGION_LANGUAGE[region] ?? 'Unknown';
}

export function lookupCandidates(code: string): string[] {
  const { prefix, region, number } = parse(code);
  const fixed = number.replace(/O/g, '0').replace(/[IL]/g, '1');
  const numbers = fixed === number ? [number] : [number, fixed];
  const candidates: string[] = [];
  for (const r of [region, 'EN', 'E', '']) {
    for (const n of numbers) candidates.push(`${prefix}-${r}${n}`);
  }
  return [...new Set(candidates)];
}

const LOOK_ALIKE_DIGIT: Record<string, string> = {
  O: '0', Q: '0', D: '0', C: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', B: '8',
};

// In the set prefix both letters and digits are possible, so each of these may stand for the other.
const LOOK_ALIKE_PAIR: Record<string, string> = {
  O: '0', '0': 'O', I: '1', '1': 'I', S: '5', '5': 'S', B: '8', '8': 'B', Z: '2', '2': 'Z',
};

// Every spelling of the prefix with look-alike characters swapped, as read first.
function prefixVariants(prefix: string): string[] {
  let variants = [''];
  for (const character of prefix) {
    const other = LOOK_ALIKE_PAIR[character];
    variants = variants.flatMap((start) => (other ? [start + character, start + other] : [start + character]));
  }
  return variants;
}

// The ways a code read by the camera may have been meant, most likely first:
// letters in the number turned into the digits they look like, then exactly as
// read, then the same with look-alike characters swapped in the set prefix.
export function readingVariants(code: string): string[] {
  const { prefix, region, number } = parse(code);
  const digits = number.replace(/[A-Z]/g, (letter) => LOOK_ALIKE_DIGIT[letter] ?? letter);
  const variants = [`${prefix}-${region}${digits}`, code];
  for (const other of prefixVariants(prefix)) variants.push(`${other}-${region}${digits}`);
  return [...new Set(variants)];
}
