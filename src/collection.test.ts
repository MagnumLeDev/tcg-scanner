import { describe, expect, it } from 'vitest';
import { createCollection, entryKey, isEntry, STORAGE_KEY, type Entry, type NewEntry } from './collection';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

const FRENCH: NewEntry = {
  code: 'LOB-FR001',
  matchedCode: 'LOB-EN001',
  language: 'French',
  name: 'Blue-Eyes White Dragon',
  setName: 'Legend of Blue Eyes White Dragon',
  rarity: 'Ultra Rare',
};
const ENGLISH: NewEntry = { ...FRENCH, code: 'LOB-EN001', language: 'English' };
const NOW = () => '2026-10-09T12:00:00.000Z';

function stored(entry: NewEntry, quantity: number): Entry {
  return { ...entry, quantity, addedAt: NOW() };
}

describe('collection', () => {
  it('starts empty', () => {
    expect(createCollection(memoryStorage()).all()).toEqual([]);
  });

  it('adds an entry with quantity 1 and saves it', () => {
    const storage = memoryStorage();
    const collection = createCollection(storage, NOW);
    expect(collection.add(FRENCH)).toBe(true);
    expect(collection.all()).toEqual([stored(FRENCH, 1)]);
    expect(JSON.parse(storage.data[STORAGE_KEY])).toEqual([stored(FRENCH, 1)]);
  });

  it('adding the same card again raises its quantity', () => {
    const collection = createCollection(memoryStorage(), NOW);
    collection.add(FRENCH);
    collection.add(FRENCH);
    expect(collection.all()).toEqual([stored(FRENCH, 2)]);
  });

  it('keeps the same code in another language or rarity as a separate entry', () => {
    const collection = createCollection(memoryStorage(), NOW);
    collection.add(FRENCH);
    collection.add(ENGLISH);
    collection.add({ ...FRENCH, language: 'German' });
    collection.add({ ...FRENCH, rarity: 'Secret Rare' });
    expect(collection.all()).toHaveLength(4);
  });

  it('returns a new array after each change', () => {
    const collection = createCollection(memoryStorage(), NOW);
    const before = collection.all();
    collection.add(FRENCH);
    expect(collection.all()).not.toBe(before);
  });

  it('sets a quantity and removes the entry below 1', () => {
    const collection = createCollection(memoryStorage(), NOW);
    collection.add(FRENCH);
    collection.setQuantity(entryKey(FRENCH), 4);
    expect(collection.all()[0].quantity).toBe(4);
    collection.setQuantity(entryKey(FRENCH), 0);
    expect(collection.all()).toEqual([]);
  });

  it('removes an entry', () => {
    const collection = createCollection(memoryStorage(), NOW);
    collection.add(FRENCH);
    collection.add(ENGLISH);
    collection.remove(entryKey(FRENCH));
    expect(collection.all()).toEqual([stored(ENGLISH, 1)]);
  });

  it('reloads what was saved', () => {
    const storage = memoryStorage();
    createCollection(storage, NOW).add(FRENCH);
    expect(createCollection(storage).all()).toEqual([stored(FRENCH, 1)]);
  });

  it('replaces the whole list', () => {
    const collection = createCollection(memoryStorage(), NOW);
    collection.add(FRENCH);
    collection.replaceAll([stored(ENGLISH, 3)]);
    expect(collection.all()).toEqual([stored(ENGLISH, 3)]);
  });

  it('merges by adding quantities and appending new entries', () => {
    const collection = createCollection(memoryStorage(), NOW);
    collection.add(FRENCH);
    collection.merge([stored(FRENCH, 2), stored(ENGLISH, 5)]);
    expect(collection.all()).toEqual([stored(FRENCH, 3), stored(ENGLISH, 5)]);
  });

  it('loads an empty list from corrupt or wrongly shaped storage', () => {
    expect(createCollection(memoryStorage({ [STORAGE_KEY]: '{not json' })).all()).toEqual([]);
    expect(createCollection(memoryStorage({ [STORAGE_KEY]: '{"a":1}' })).all()).toEqual([]);
    expect(createCollection(memoryStorage({ [STORAGE_KEY]: '"text"' })).all()).toEqual([]);
    expect(createCollection(memoryStorage({ [STORAGE_KEY]: 'null' })).all()).toEqual([]);
  });

  it('drops stored entries that are not valid and keeps the rest', () => {
    const good = stored(FRENCH, 2);
    const raw = JSON.stringify([good, { code: 'LOB-FR001' }, { ...good, quantity: 0 }, { ...good, language: 'Klingon' }, 7, null]);
    expect(createCollection(memoryStorage({ [STORAGE_KEY]: raw })).all()).toEqual([good]);
  });

  it('keeps the list in memory and reports failure when storage is full', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const collection = createCollection(storage, NOW);
    expect(collection.add(FRENCH)).toBe(false);
    expect(collection.all()).toEqual([stored(FRENCH, 1)]);
  });

  it('survives storage that throws on read', () => {
    const storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    };
    expect(createCollection(storage).all()).toEqual([]);
  });
});

describe('isEntry', () => {
  it('accepts a complete entry and rejects incomplete ones', () => {
    const good = stored(FRENCH, 1);
    expect(isEntry(good)).toBe(true);
    expect(isEntry({ ...good, quantity: 1.5 })).toBe(false);
    expect(isEntry({ ...good, code: 'not a code' })).toBe(false);
    expect(isEntry({ ...good, name: 5 })).toBe(false);
    expect(isEntry(undefined)).toBe(false);
  });
});
