import { afterEach, describe, expect, it, vi } from 'vitest';
import { flatten, ygoprodeck } from './ygoprodeck';

const SAMPLE = {
  data: [
    {
      id: 89631139,
      name: 'Blue-Eyes White Dragon',
      card_sets: [
        { set_name: 'Legend of Blue Eyes White Dragon', set_code: 'LOB-EN001', set_rarity: 'Ultra Rare', set_price: '0' },
        { set_name: 'Starter Deck: Kaiba', set_code: 'SDK-001', set_rarity: 'Ultra Rare', set_price: '0' },
        { set_name: 'Duel Terminal', set_code: 'DB49', set_rarity: 'Common', set_price: '0' },
      ],
    },
    {
      id: 1,
      name: 'Two Rarities',
      card_sets: [
        { set_name: 'Some Set', set_code: 'RA01-EN010', set_rarity: 'Ultra Rare' },
        { set_name: 'Some Set', set_code: 'RA01-EN010', set_rarity: 'Secret Rare' },
        { set_name: 'Some Set', set_code: 'RA01-EN010', set_rarity: 'Secret Rare' },
        { set_name: 'Mystery', set_code: 'MF03-EN0??', set_rarity: 'Common' },
      ],
    },
    { id: 2, name: 'No Printings' },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('flatten', () => {
  it('produces one printing per card-and-set entry', () => {
    expect(flatten(SAMPLE)).toEqual([
      { code: 'LOB-EN001', name: 'Blue-Eyes White Dragon', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare' },
      { code: 'SDK-001', name: 'Blue-Eyes White Dragon', setName: 'Starter Deck: Kaiba', rarity: 'Ultra Rare' },
      { code: 'RA01-EN010', name: 'Two Rarities', setName: 'Some Set', rarity: 'Ultra Rare' },
      { code: 'RA01-EN010', name: 'Two Rarities', setName: 'Some Set', rarity: 'Secret Rare' },
    ]);
  });

  it('throws on an unexpected shape', () => {
    expect(() => flatten({ error: 'nope' })).toThrow(/format/i);
    expect(() => flatten(null)).toThrow(/format/i);
  });
});

describe('ygoprodeck source', () => {
  it('reads the version from checkDBVer', async () => {
    const fetchMock = vi.fn(
      async (_url: string) => new Response(JSON.stringify([{ database_version: '147.23', last_update: 'x' }])),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(ygoprodeck.fetchVersion()).resolves.toBe('147.23');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://db.ygoprodeck.com/api/v7/checkDBVer.php');
  });

  it('fetches and flattens all cards', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(SAMPLE)));
    vi.stubGlobal('fetch', fetchMock);
    await expect(ygoprodeck.fetchPrintings()).resolves.toHaveLength(4);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://db.ygoprodeck.com/api/v7/cardinfo.php');
  });

  it('fails clearly on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    await expect(ygoprodeck.fetchVersion()).rejects.toThrow(/503/);
    await expect(ygoprodeck.fetchPrintings()).rejects.toThrow(/503/);
  });

  it('fails clearly on an unexpected version payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}))));
    await expect(ygoprodeck.fetchVersion()).rejects.toThrow(/format/i);
  });
});
