import { lookupCandidates, parse, printedCode, type Language } from './setCode';
import type { Printing } from './sources/types';

export type Lookup = {
  find(code: string): Printing[];
  suggest(code: string): string[];
};

export type Match = { printings: Printing[]; matchedCode: string };

const MAX_SUGGESTIONS = 5;

export function match(db: Lookup, code: string): Match | null {
  for (const candidate of lookupCandidates(code)) {
    const printings = db.find(candidate);
    if (printings.length > 0) return { printings, matchedCode: candidate };
  }
  return null;
}

// Near misses are found on the database's (English) form of the code, then put
// back into the printed form so the language of the card is not lost.
export function suggestions(db: Lookup, code: string): string[] {
  const { region } = parse(code);
  const found = new Set<string>();
  for (const candidate of lookupCandidates(code)) {
    for (const near of db.suggest(candidate)) {
      const { prefix, number } = parse(near);
      const printed = `${prefix}-${region}${number}`;
      if (printed === code || found.has(printed) || match(db, printed) === null) continue;
      found.add(printed);
      if (found.size === MAX_SUGGESTIONS) return [...found];
    }
  }
  return [...found];
}

// The code of a card that was printed in one set only, as printed in the given
// language: there is then nothing to choose between.
export function onlyCode(printings: Printing[], language: Language): string | null {
  const codes = new Set(printings.map((p) => p.code));
  if (codes.size !== 1) return null;
  return printedCode([...codes][0], language);
}
