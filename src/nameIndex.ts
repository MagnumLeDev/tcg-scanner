import type { Language } from './setCode';

export type NameEntry = { cardId: number; name: string; language: Language };
export type NameMatch = NameEntry & { score: number };
export type NameIndex = { find(text: string): NameMatch | null };

const MIN_SCORE = 0.8; // how alike the reading and the name must be, from 0 to 1
const MIN_LEAD = 0.1; // how far ahead of the best other card the winner must be
const MIN_LENGTH = 4; // shorter texts are alike too easily
const SHORTLIST = 20; // names compared letter by letter with the reading

// The text reader lacks several accented letters and reads names in small
// capitals, so names are compared on plain lower-case letters and digits only.
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function sequences(text: string): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i + 3 <= text.length; i++) found.add(text.slice(i, i + 3));
  return found;
}

// The number of single-character changes that turn one text into the other.
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

// Files every name under its three-letter sequences, so that a reading is only
// compared letter by letter with the few names that share the most of them.
export function buildNameIndex(entries: NameEntry[]): NameIndex {
  const keys: string[] = []; // each distinct normalised name
  const entriesOf: NameEntry[][] = []; // the cards and languages it stands for
  const position = new Map<string, number>();
  const bySequence = new Map<string, number[]>();

  for (const entry of entries) {
    const key = normalise(entry.name);
    if (key.length < MIN_LENGTH) continue;
    let at = position.get(key);
    if (at === undefined) {
      at = keys.length;
      position.set(key, at);
      keys.push(key);
      entriesOf.push([]);
      for (const sequence of sequences(key)) {
        const list = bySequence.get(sequence);
        if (list) list.push(at);
        else bySequence.set(sequence, [at]);
      }
    }
    entriesOf[at].push(entry);
  }

  const shared = new Uint16Array(keys.length); // sequences in common with the reading; all zero between lookups

  return {
    find(text) {
      const read = normalise(text);
      if (read.length < MIN_LENGTH) return null;

      const touched: number[] = [];
      for (const sequence of sequences(read)) {
        for (const at of bySequence.get(sequence) ?? []) {
          if (shared[at]++ === 0) touched.push(at);
        }
      }
      // Among names sharing as much, the one closest in length is the likeliest.
      touched.sort(
        (a, b) => shared[b] - shared[a] || Math.abs(keys[a].length - read.length) - Math.abs(keys[b].length - read.length),
      );
      const shortlist = touched.slice(0, SHORTLIST);
      for (const at of touched) shared[at] = 0;

      const scored: NameMatch[] = [];
      for (const at of shortlist) {
        const score = 1 - distance(read, keys[at]) / Math.max(read.length, keys[at].length);
        for (const entry of entriesOf[at]) scored.push({ ...entry, score });
      }
      scored.sort((a, b) => b.score - a.score);

      const best = scored[0];
      if (!best || best.score < MIN_SCORE) return null;
      const rival = scored.find((other) => other.cardId !== best.cardId);
      if (rival && best.score - rival.score < MIN_LEAD) return null;
      // A name spelled the same in several languages does not say which one the card is in.
      const sameInOthers = scored.some((other) => other.cardId === best.cardId && other.score === best.score && other.language !== best.language);
      return sameInOthers ? { ...best, language: 'Unknown' } : best;
    },
  };
}
