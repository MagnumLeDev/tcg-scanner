import { withinOne } from './cardDatabase';
import type { Match } from './cardMatch';
import type { NameMatch } from './nameIndex';
import type { Reading } from './ocr/decode';
import { candidateCodes, parse, type Language } from './setCode';
import type { Printing } from './sources/types';

export type Cards = {
  find(code: string): Match | null;
  findByName(text: string): NameMatch | null;
  printingsOf(cardId: number): Printing[];
};

// A card found by its code, or by its name alone when no code could be read.
export type Detection =
  | { kind: 'code'; code: string; match: Match }
  | { kind: 'card'; cardId: number; name: string; language: Language };

export type Detector = {
  // Takes what one camera reading gave; returns a card once it is certain enough.
  feed(reading: Reading): Detection | null;
  // Stops reporting this card until it has left the view.
  dismiss(detection: Detection): void;
};

const SURE = 0.8; // a line read with at least this confidence is trusted on its own
const WINDOW = 3; // otherwise a code or a name is trusted once read twice within this many readings; a name is also remembered this long
const RELEASE = 3; // readings in a row without a dismissed card before it counts again

export function createDetector(cards: Cards): Detector {
  const lastSeen = new Map<string, number>(); // code -> number of the reading it was last in
  const dismissedCodes = new Map<string, number>(); // code -> readings in a row without it
  const dismissedCards = new Map<number, number>(); // card id -> readings in a row without it
  // The name comes from whole-picture readings and the code often from
  // close-ups, so the last name is kept for the readings that follow.
  let named: { match: NameMatch; at: number; before: number | null } | null = null;
  let reading = 0;

  const isCard = (match: Match, cardId: number) => match.printings.some((printing) => printing.cardId === cardId);

  // The code the named card is printed under that is one character away from
  // the code read, written with the language marker that was read.
  function nearCode(candidate: string, cardId: number): Detection | null {
    const read = parse(candidate);
    for (const printing of cards.printingsOf(cardId)) {
      const known = parse(printing.code);
      if (!withinOne(`${read.prefix}-${read.number}`, `${known.prefix}-${known.number}`)) continue;
      const code = `${known.prefix}-${read.region}${known.number}`;
      const match = cards.find(code);
      if (match && isCard(match, cardId)) return { kind: 'code', code, match };
    }
    return null;
  }

  function blocked(detection: Detection): boolean {
    if (detection.kind === 'card') return dismissedCards.has(detection.cardId);
    return dismissedCodes.has(detection.code) || detection.match.printings.some((printing) => dismissedCards.has(printing.cardId));
  }

  function age<Key>(dismissed: Map<Key, number>, inView: (key: Key) => boolean): void {
    for (const [key, misses] of dismissed) {
      if (inView(key)) dismissed.set(key, 0);
      else if (misses + 1 >= RELEASE) dismissed.delete(key);
      else dismissed.set(key, misses + 1);
    }
  }

  function accept(detection: Detection): Detection {
    lastSeen.clear();
    named = null;
    return detection;
  }

  return {
    feed({ codes, names }) {
      reading++;

      for (const line of names) {
        const match = cards.findByName(line.text);
        if (!match) continue;
        named = { match, at: reading, before: named && named.match.cardId === match.cardId ? named.at : null };
        break;
      }
      if (named && reading - named.at >= WINDOW) named = null;
      const name = named?.match ?? null;

      const seen = new Map<string, { match: Match; sure: boolean }>();
      let agreed: Detection | null = null; // a code that exists and belongs to the named card
      let corrected: Detection | null = null; // the named card's code, one character from what was read
      for (const line of codes) {
        const candidates = candidateCodes(line.text);
        for (const code of candidates) {
          const match = cards.find(code);
          if (!match) continue;
          seen.set(code, { match, sure: line.confidence >= SURE || seen.get(code)?.sure === true });
          if (name && isCard(match, name.cardId)) agreed ??= { kind: 'code', code, match };
          break;
        }
        if (name && !agreed && !corrected) {
          for (const candidate of candidates) {
            corrected = nearCode(candidate, name.cardId);
            if (corrected) break;
          }
        }
      }

      const cardsInView = new Set<number>();
      if (named?.at === reading) cardsInView.add(named.match.cardId);
      for (const { match } of seen.values()) for (const printing of match.printings) cardsInView.add(printing.cardId);
      age(dismissedCodes, (code) => seen.has(code));
      age(dismissedCards, (cardId) => cardsInView.has(cardId));

      if (agreed) return blocked(agreed) ? null : accept(agreed);
      if (corrected && !blocked(corrected)) return accept(corrected);

      for (const [code, { match, sure }] of seen) {
        const detection: Detection = { kind: 'code', code, match };
        if (blocked(detection)) continue;
        const previous = lastSeen.get(code);
        // A name that says another card takes away the benefit of the doubt.
        if ((sure && !name) || (previous !== undefined && reading - previous < WINDOW)) return accept(detection);
        lastSeen.set(code, reading);
      }

      if (seen.size === 0 && named && named.at === reading && named.before !== null && reading - named.before < WINDOW) {
        const { cardId, name: cardName, language } = named.match;
        const detection: Detection = { kind: 'card', cardId, name: cardName, language };
        if (!blocked(detection)) return accept(detection);
      }
      return null;
    },

    dismiss(detection) {
      if (detection.kind === 'card') {
        dismissedCards.set(detection.cardId, 0);
        return;
      }
      dismissedCodes.set(detection.code, 0);
      lastSeen.delete(detection.code);
      // 0 marks data saved before names existed: no card to tell apart.
      for (const printing of detection.match.printings) {
        if (printing.cardId) dismissedCards.set(printing.cardId, 0);
      }
    },
  };
}
