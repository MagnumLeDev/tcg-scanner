import type { Match } from './cardMatch';
import type { Line } from './ocr/decode';
import { candidateCodes } from './setCode';

export type Detection = { code: string; match: Match };

export type Detector = {
  // Takes the lines of text of one camera reading; returns a card once it is certain enough.
  feed(lines: Line[]): Detection | null;
  // Stops reporting this code until its card has left the view.
  dismiss(code: string): void;
};

const SURE = 0.8; // a line read with at least this confidence is trusted on its own
const WINDOW = 3; // otherwise a code is trusted once it is read twice within this many readings
const RELEASE = 3; // readings in a row without a dismissed code before it counts again

export function createDetector(find: (code: string) => Match | null): Detector {
  const lastSeen = new Map<string, number>(); // code -> number of the reading it was last in
  const dismissed = new Map<string, number>(); // code -> readings in a row without it
  let reading = 0;

  return {
    feed(lines) {
      reading++;
      const seen = new Map<string, { match: Match; sure: boolean }>();
      for (const line of lines) {
        for (const code of candidateCodes(line.text)) {
          const match = find(code);
          if (!match) continue;
          seen.set(code, { match, sure: line.confidence >= SURE || seen.get(code)?.sure === true });
          break;
        }
      }

      for (const [code, misses] of dismissed) {
        if (seen.has(code)) dismissed.set(code, 0);
        else if (misses + 1 >= RELEASE) dismissed.delete(code);
        else dismissed.set(code, misses + 1);
      }

      for (const [code, { match, sure }] of seen) {
        if (dismissed.has(code)) continue;
        const previous = lastSeen.get(code);
        if (sure || (previous !== undefined && reading - previous < WINDOW)) {
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
