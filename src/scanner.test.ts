import { describe, expect, it } from 'vitest';
import type { Detection } from './detector';
import type { Line, Reading } from './ocr/decode';
import { createScanner } from './scanner';
import type { Printing } from './sources/types';

type Picture = { name: string; codes: string; view: number[] };

const line = (text: string): Line[] => (text ? [{ text, confidence: 0.9 }] : []);
const printing = (code: string, cardId: number): Printing => ({ code, cardId, name: 'Card', setName: 'Set', rarity: 'Common' });

// Card 1 exists in two sets, card 2 in one.
const PRINTINGS = [printing('LOB-EN001', 1), printing('SDK-001', 1), printing('LOB-EN002', 2)];
const CARD: Record<string, number> = { 'BLUE-EYES': 1, GIANT: 2 };

function setup(detect: (reading: Reading) => Detection | null = () => null) {
  const calls: string[] = [];
  const fed: Reading[] = [];
  const scanner = createScanner<Picture>({
    reader: {
      readName: async (picture) => (calls.push('name'), line(picture.name)),
      // Reads line after line, as the real reader does, until told it is enough.
      readCodes: async (picture, enough) => {
        calls.push('codes');
        const read: Line[] = [];
        for (const text of picture.codes.split('|').filter(Boolean)) {
          read.push({ text, confidence: 0.9 });
          if (enough(read[read.length - 1])) break;
        }
        return read;
      },
      readAll: async (picture) => (calls.push('all'), { codes: line(picture.codes), names: [], whole: true }),
    },
    findByName: (text) => (CARD[text] ? { cardId: CARD[text], name: text, language: 'English', score: 1 } : null),
    printingsOf: (cardId) => PRINTINGS.filter((p) => p.cardId === cardId),
    isCode: (text) => PRINTINGS.some((p) => p.code === text),
    feed: (reading) => (fed.push(reading), detect(reading)),
    glance: (picture) => picture.view,
  });
  return { scanner, calls, fed };
}

const picture = (name: string, codes = '', view = [100, 100, 100, 100]): Picture => ({ name, codes, view });

describe('createScanner', () => {
  it('reads only the name of a card that exists in a single set', async () => {
    const { scanner, calls, fed } = setup();
    await scanner.look(picture('GIANT', 'LOB-EN002'));
    expect(calls).toEqual(['name']);
    expect(fed[0]).toEqual({ codes: [], names: line('GIANT'), whole: true });
  });

  it('looks at the code as well when the named card exists in several sets', async () => {
    const { scanner, calls, fed } = setup();
    await scanner.look(picture('BLUE-EYES', 'SDK-001'));
    expect(calls).toEqual(['name', 'codes']);
    expect(fed[0]).toEqual({ codes: line('SDK-001'), names: line('BLUE-EYES'), whole: true });
  });

  it('stops reading lines once one of them is a code that exists', async () => {
    const { scanner, fed } = setup();
    await scanner.look(picture('BLUE-EYES', 'ATK/3000|SDK-001|1996 KAZUKI'));
    expect(fed[0].codes.map((l) => l.text)).toEqual(['ATK/3000', 'SDK-001']);
  });

  it('reads everything when no name is recognised', async () => {
    const { scanner, calls, fed } = setup();
    await scanner.look(picture('UNKNOWN NAME', 'LOB-EN002'));
    expect(calls).toEqual(['name', 'all']);
    expect(fed[0].codes).toEqual(line('LOB-EN002'));
  });

  it('gives back what the detector found and what was read', async () => {
    const found: Detection = { kind: 'card', cardId: 2, name: 'GIANT', language: 'English' };
    const { scanner } = setup(() => found);
    const look = await scanner.look(picture('GIANT'));
    expect(look.detection).toBe(found);
    expect(look.reading?.names).toEqual(line('GIANT'));
  });

  it('stops reading a picture that stays the same and gives nothing', async () => {
    const { scanner, calls } = setup();
    for (let i = 0; i < 4; i++) await scanner.look(picture(''));
    const before = calls.length;
    const look = await scanner.look(picture(''));
    expect(calls.length).toBe(before);
    expect(look).toEqual({ detection: null, reading: null });
  });

  it('still takes a look now and then at a picture that stays the same', async () => {
    const { scanner, calls } = setup();
    for (let i = 0; i < 4; i++) await scanner.look(picture(''));
    const before = calls.length;
    for (let i = 0; i < 8; i++) await scanner.look(picture(''));
    expect(calls.length).toBe(before);
    await scanner.look(picture(''));
    expect(calls.length).toBeGreaterThan(before);
  });

  it('is not stopped by the small changes of a hand-held camera', async () => {
    const { scanner, calls } = setup();
    for (let i = 0; i < 4; i++) await scanner.look(picture('', '', [100 + i, 100 - i, 101, 99]));
    const before = calls.length;
    await scanner.look(picture('', '', [102, 98, 100, 101]));
    expect(calls.length).toBe(before);
  });

  it('reads again as soon as the picture changes', async () => {
    const { scanner, calls } = setup();
    for (let i = 0; i < 5; i++) await scanner.look(picture(''));
    const before = calls.length;
    await scanner.look(picture('GIANT', '', [30, 180, 90, 140]));
    expect(calls.length).toBe(before + 1);
  });

  it('reads again after a restart, even if the picture is the same', async () => {
    const { scanner, calls } = setup();
    for (let i = 0; i < 5; i++) await scanner.look(picture(''));
    const before = calls.length;
    scanner.restart();
    await scanner.look(picture(''));
    expect(calls.length).toBeGreaterThan(before);
  });
});
