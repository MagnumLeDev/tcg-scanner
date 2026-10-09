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

export function extract(text: string): string | null {
  const cleaned = text
    .toUpperCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, '-');
  const found = CODE_IN_TEXT.exec(cleaned);
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
