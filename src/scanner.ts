import type { Detection } from './detector';
import type { NameMatch } from './nameIndex';
import type { Line, Reading } from './ocr/decode';
import type { Printing } from './sources/types';

export type Reader<Picture> = {
  // The line the card name is on, alone: quick.
  readName(picture: Picture): Promise<Line[]>;
  // The lines around where the set code is printed, one after the other until one is enough.
  readCodes(picture: Picture, enough: (line: Line) => boolean): Promise<Line[]>;
  // Every line that may be a code or a name: slow.
  readAll(picture: Picture): Promise<Reading>;
};

// What one look at the camera gave. Nothing was read when the picture had not
// changed since several looks that gave nothing.
export type Look = { detection: Detection | null; reading: Reading | null };

const IDLE_AFTER = 4; // looks at the same picture that give nothing before reading stops
const IDLE_SKIPS = 8; // looks left out in a row before one is taken anyway: the camera may have focused since
const CHANGE = 10; // average difference in brightness, out of 255, that counts as another picture

function changed(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return true;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i]);
  return difference / a.length > CHANGE;
}

// Decides how much of each camera picture is read. The name is read first, as
// it is quick and usually tells which card this is; the rest is read only as
// far as it is still needed. A picture that stays the same and gives nothing is
// left alone, so that the phone is not kept busy while nothing happens.
export function createScanner<Picture>(parts: {
  reader: Reader<Picture>;
  findByName(text: string): NameMatch | null;
  printingsOf(cardId: number): Printing[];
  // Whether a line that was read holds a set code that exists.
  isCode(text: string): boolean;
  feed(reading: Reading): Detection | null;
  // A few brightness values that sum the picture up, to tell whether it changed.
  glance(picture: Picture): number[];
}) {
  const { reader, findByName, printingsOf, isCode, feed, glance } = parts;
  let reference: number[] | null = null; // the picture the looks without result started from
  let fruitless = 0;
  let skipped = 0;

  async function read(picture: Picture): Promise<Reading> {
    const names = await reader.readName(picture);
    let card: number | null = null;
    for (const line of names) {
      card = findByName(line.text)?.cardId ?? null;
      if (card !== null) break;
    }
    if (card === null) return reader.readAll(picture);
    // A card printed in one set only has one possible code: no need to read it.
    const sets = new Set(printingsOf(card).map((printing) => printing.code)).size;
    return { codes: sets > 1 ? await reader.readCodes(picture, (line) => isCode(line.text)) : [], names, whole: true };
  }

  return {
    async look(picture: Picture): Promise<Look> {
      const view = glance(picture);
      if (reference && !changed(view, reference)) {
        if (fruitless >= IDLE_AFTER && skipped < IDLE_SKIPS) {
          skipped++;
          return { detection: null, reading: null };
        }
      } else {
        reference = view;
        fruitless = 0;
      }
      skipped = 0;
      const reading = await read(picture);
      const detection = feed(reading);
      if (detection) reference = null;
      else fruitless++;
      return { detection, reading };
    },

    // Reads the next picture whatever it shows, e.g. after a card was set aside.
    restart(): void {
      reference = null;
      fruitless = 0;
      skipped = 0;
    },
  };
}
