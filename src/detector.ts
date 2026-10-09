import type { Match } from './cardMatch';
import { extractAll, readingVariants } from './setCode';

export type Detection = { code: string; match: Match };

export type Detector = {
  // Takes the text of one camera reading; returns a card once it is certain enough.
  feed(text: string): Detection | null;
  // Stops reporting this code until its card has left the view.
  dismiss(code: string): void;
};

const WINDOW = 3; // a code is trusted once it is read twice within this many readings
const RELEASE = 3; // readings in a row without a dismissed code before it counts again

export function createDetector(find: (code: string) => Match | null): Detector {
  const lastSeen = new Map<string, number>(); // code -> number of the reading it was last in
  const dismissed = new Map<string, number>(); // code -> readings in a row without it
  let reading = 0;

  return {
    feed(text) {
      reading++;
      const seen = new Map<string, Match>();
      for (const read of extractAll(text)) {
        for (const code of readingVariants(read)) {
          const match = find(code);
          if (!match) continue;
          seen.set(code, match);
          break;
        }
      }

      for (const [code, misses] of dismissed) {
        if (seen.has(code)) dismissed.set(code, 0);
        else if (misses + 1 >= RELEASE) dismissed.delete(code);
        else dismissed.set(code, misses + 1);
      }

      for (const [code, match] of seen) {
        if (dismissed.has(code)) continue;
        const previous = lastSeen.get(code);
        if (previous !== undefined && reading - previous < WINDOW) {
          lastSeen.clear();
          return { code, match };
        }
        lastSeen.set(code, reading);
      }
      return null;
    },

    dismiss(code) {
      dismissed.set(code, 0);
      lastSeen.delete(code);
    },
  };
}
