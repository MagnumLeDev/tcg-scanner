import { describe, expect, it } from 'vitest';
import { match, suggestions, type Lookup } from './cardMatch';
import type { Printing } from './sources/types';

function printing(code: string, rarity = 'Common'): Printing {
  return { code, name: `Card ${code}`, setName: 'Set', rarity };
}

function lookup(printings: Printing[], near: Record<string, string[]> = {}): Lookup {
  return {
    find: (code) => printings.filter((p) => p.code === code),
    suggest: (code) => near[code] ?? [],
  };
}

describe('match', () => {
  it('finds an English code directly', () => {
    const db = lookup([printing('LOB-EN001')]);
    expect(match(db, 'LOB-EN001')).toEqual({ printings: [printing('LOB-EN001')], matchedCode: 'LOB-EN001' });
  });

  it('resolves a French code to the English entry', () => {
    const db = lookup([printing('LOB-EN001')]);
    expect(match(db, 'LOB-FR001')?.matchedCode).toBe('LOB-EN001');
  });

  it('resolves an old European code to a regionless entry', () => {
    const db = lookup([printing('LOB-001')]);
    expect(match(db, 'LOB-F001')?.matchedCode).toBe('LOB-001');
  });

  it('prefers the code as printed over other candidates', () => {
    const db = lookup([printing('LOB-EN001'), printing('LOB-E001')]);
    expect(match(db, 'LOB-E001')?.matchedCode).toBe('LOB-E001');
  });

  it('fixes misread letters in the number', () => {
    const db = lookup([printing('LOB-EN001')]);
    expect(match(db, 'LOB-FRO0I')?.matchedCode).toBe('LOB-EN001');
  });

  it('returns every rarity of the matched code', () => {
    const db = lookup([printing('RA01-EN010', 'Ultra Rare'), printing('RA01-EN010', 'Secret Rare')]);
    expect(match(db, 'RA01-EN010')?.printings).toHaveLength(2);
  });

  it('returns null when nothing matches', () => {
    expect(match(lookup([]), 'LOB-EN001')).toBeNull();
  });
});

describe('suggestions', () => {
  it('suggests near codes in the printed language form', () => {
    const db = lookup([printing('LOB-EN001')], { 'L0B-EN001': ['LOB-EN001'] });
    expect(suggestions(db, 'L0B-FR001')).toEqual(['LOB-FR001']);
  });

  it('keeps an English code English', () => {
    const db = lookup([printing('LOB-EN001')], { 'L0B-EN001': ['LOB-EN001'] });
    expect(suggestions(db, 'L0B-EN001')).toEqual(['LOB-EN001']);
  });

  it('drops suggestions that would not resolve and the code itself', () => {
    const db = lookup([printing('LOB-EN001')], { 'LOB-EN00X': ['LOB-EN001', 'LOB-EN009', 'LOB-EN00X'] });
    expect(suggestions(db, 'LOB-EN00X')).toEqual(['LOB-EN001']);
  });

  it('returns at most five, without duplicates', () => {
    const codes = ['001', '002', '003', '004', '005', '006', '007'].map((n) => `LOB-EN${n}`);
    const db = lookup(codes.map((c) => printing(c)), { 'LOB-FR00X': [], 'LOB-EN00X': codes, 'LOB-E00X': codes });
    expect(suggestions(db, 'LOB-FR00X')).toEqual([
      'LOB-FR001', 'LOB-FR002', 'LOB-FR003', 'LOB-FR004', 'LOB-FR005',
    ]);
  });

  it('returns nothing when there are no near codes', () => {
    expect(suggestions(lookup([]), 'ZZZ-EN999')).toEqual([]);
  });
});
