import { describe, expect, it } from 'vitest';
import { buildNameIndex, normalise, type NameEntry } from './nameIndex';

const ENTRIES: NameEntry[] = [
  { cardId: 1, name: 'Blue-Eyes White Dragon', language: 'English' },
  { cardId: 1, name: 'Dragon Blanc aux Yeux Bleus', language: 'French' },
  { cardId: 2, name: 'Dark Magician', language: 'English' },
  { cardId: 3, name: 'Dark Magician Girl', language: 'English' },
  { cardId: 4, name: "Renfort de l'Armée", language: 'French' },
  { cardId: 5, name: 'Kuriboh', language: 'English' },
  { cardId: 6, name: 'Kuribon', language: 'English' },
  { cardId: 7, name: 'Pot', language: 'English' },
  { cardId: 8, name: 'Change of Heart', language: 'English' },
  { cardId: 8, name: 'Change of Heart', language: 'Italian' },
];

describe('normalise', () => {
  it('drops case, accents, spaces and punctuation', () => {
    expect(normalise("Renfort de l'Armée")).toBe('renfortdelarmee');
    expect(normalise('Blue-Eyes White Dragon')).toBe('blueeyeswhitedragon');
    expect(normalise('Zauberer Über')).toBe('zaubereruber');
  });
});

describe('buildNameIndex', () => {
  const index = buildNameIndex(ENTRIES);

  it('finds a name read exactly, with its language', () => {
    expect(index.find('Dragon Blanc aux Yeux Bleus')).toEqual({ cardId: 1, name: 'Dragon Blanc aux Yeux Bleus', language: 'French', score: 1 });
  });

  it('finds a name read without accents, in capitals and with a wrong letter', () => {
    const found = index.find('RENFORT DE LARMFE');
    expect(found?.cardId).toBe(4);
    expect(found!.score).toBeGreaterThanOrEqual(0.8);
    expect(found!.score).toBeLessThan(1);
  });

  it('returns nothing for a reading too far from any name', () => {
    expect(index.find('RENF0RT D3 LAXWEE QQ')).toBeNull();
  });

  it('returns nothing for text that is no card name', () => {
    expect(index.find('[CARTE MAGIE]')).toBeNull();
    expect(index.find('')).toBeNull();
    expect(index.find('---')).toBeNull();
  });

  it('prefers the full name over a longer name that starts the same', () => {
    expect(index.find('Dark Magician')?.cardId).toBe(2);
    expect(index.find('Dark Magician Girl')?.cardId).toBe(3);
  });

  it('refuses to choose between two close names', () => {
    // One letter from both "Kuriboh" and "Kuribon".
    expect(index.find('Kuribom')).toBeNull();
  });

  it('does not treat the same card in two languages as a rival', () => {
    expect(index.find('Change of Heart')?.cardId).toBe(8);
  });

  it('ignores names and readings shorter than four characters', () => {
    expect(index.find('Pot')).toBeNull();
    expect(index.find('Po')).toBeNull();
  });

  it('finds a short name among many longer ones', () => {
    const many: NameEntry[] = [{ cardId: 1, name: 'Dark Magician', language: 'English' }];
    for (let i = 0; i < 40; i++) many.push({ cardId: 100 + i, name: `Dark Magician of the ${i} Realms`, language: 'English' });
    expect(buildNameIndex(many).find('Dark Magician')?.cardId).toBe(1);
  });

  it('finds nothing in an empty index', () => {
    expect(buildNameIndex([]).find('Dark Magician')).toBeNull();
  });
});
