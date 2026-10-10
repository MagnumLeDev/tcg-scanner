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

export function parse(code: string): { prefix: string; region: string; number: string } {
  const hyphen = code.indexOf('-');
  const prefix = code.slice(0, hyphen);
  const rest = code.slice(hyphen + 1);
  return { prefix, region: rest.slice(0, -3), number: rest.slice(-3) };
}

export function languageOf(region: string): Language {
  return REGION_LANGUAGE[region] ?? 'Unknown';
}

// Whether a card with this code can be in the given language. A code without a
// language marker says nothing, so it fits every language.
export function inLanguage(code: string, language: Language): boolean {
  const { region } = parse(code);
  return region === '' || languageOf(region) === language;
}

const MODERN_MARKER: Partial<Record<Language, string>> = { French: 'FR', German: 'DE', Italian: 'IT', Spanish: 'SP', Portuguese: 'PT' };
const OLD_MARKER: Partial<Record<Language, string>> = { French: 'F', German: 'G', Italian: 'I', Spanish: 'S', Portuguese: 'P' };

// The code as it is printed on a card in the given language, from the database's
// (English) form. Left as it is when the code carries no language marker.
export function printedCode(code: string, language: Language): string {
  const { prefix, region, number } = parse(code);
  const marker = region === 'EN' ? MODERN_MARKER[language] : region === 'E' ? OLD_MARKER[language] : undefined;
  return marker ? `${prefix}-${marker}${number}` : code;
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

const LOOK_ALIKE_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '6': 'G' };

const HYPHENATED = /([A-Z0-9]+)-([A-Z0-9]+)/g;

// The set codes a line of text read by the camera may contain, most likely
// first. The reading is taken apart at the hyphen: a set prefix before it, then
// a language marker and a three-character number. Characters that cannot be
// right where they stand (a letter in the number, a digit in the language
// marker) are replaced by their look-alikes, and stray characters around the
// code are dropped. The caller keeps the first candidate that exists.
export function candidateCodes(line: string): string[] {
  const primary: string[] = [];
  const swapped: string[] = [];

  for (const [, before, after] of clean(line).matchAll(HYPHENATED)) {
    const endings: string[] = []; // language marker + number, as they may have been meant
    for (let length = Math.min(5, after.length); length >= 3; length--) {
      const rest = after.slice(length);
      const marker = after.slice(0, length - 3).replace(/[0-9]/g, (digit) => LOOK_ALIKE_LETTER[digit] ?? digit);
      if (!(marker in REGION_LANGUAGE)) continue;
      const number = after.slice(length - 3, length);
      const digits = number.replace(/[A-Z]/g, (letter) => LOOK_ALIKE_DIGIT[letter] ?? letter);
      // A digit right after the number means the number was longer: not a set code.
      if (/^\d{3}$/.test(digits) && !/^\d/.test(rest)) endings.push(marker + digits);
      if (digits !== number && rest === '') endings.push(marker + number);
    }

    for (let length = Math.min(5, before.length); length >= 2; length--) {
      const prefix = before.slice(-length);
      for (const ending of endings) primary.push(`${prefix}-${ending}`);
      for (const other of prefixVariants(prefix)) {
        for (const ending of endings) swapped.push(`${other}-${ending}`);
      }
    }
  }
  return [...new Set([...primary, ...swapped])];
}
