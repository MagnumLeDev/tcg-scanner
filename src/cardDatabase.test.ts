import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createCardDatabase, withinOne } from './cardDatabase';
import type { Language } from './setCode';
import type { CardName, Printing, Source } from './sources/types';

// A fresh, empty in-memory IndexedDB per call, typed as the browser's factory.
const freshIdb = (): IDBFactory => new FakeIDBFactory() as unknown as IDBFactory;

const BEWD: Printing = { code: 'LOB-EN001', cardId: 1, name: 'Blue-Eyes White Dragon', setName: 'LOB', rarity: 'Ultra Rare' };
const DM: Printing = { code: 'LOB-EN005', cardId: 2, name: 'Dark Magician', setName: 'LOB', rarity: 'Ultra Rare' };
const ULTRA: Printing = { code: 'RA01-EN010', cardId: 3, name: 'Two Rarities', setName: 'RA01', rarity: 'Ultra Rare' };
const SECRET: Printing = { code: 'RA01-EN010', cardId: 3, name: 'Two Rarities', setName: 'RA01', rarity: 'Secret Rare' };

function fakeSource(id: string, printings: Printing[]) {
  const state = {
    version: '1',
    printings,
    fail: false,
    versionCalls: 0,
    printingsCalls: 0,
    hold: null as Promise<void> | null,
    languages: [] as Language[],
    names: {} as Partial<Record<Language, CardName[]>>,
    failNames: new Set<Language>(),
    namesCalls: [] as Language[],
  };
  const source: Source = {
    id,
    name: `Fake ${id}`,
    async fetchVersion() {
      state.versionCalls++;
      if (state.hold) await state.hold;
      if (state.fail) throw new Error('offline');
      return state.version;
    },
    async fetchPrintings() {
      state.printingsCalls++;
      if (state.fail) throw new Error('offline');
      return state.printings;
    },
    get nameLanguages() {
      return state.languages;
    },
    async fetchNames(language) {
      state.namesCalls.push(language);
      if (state.failNames.has(language)) throw new Error('offline');
      return state.names[language] ?? [];
    },
  };
  return { source, state };
}

function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

function clock() {
  let tick = 0;
  return () => `2026-10-09T00:00:${String(tick++).padStart(2, '0')}.000Z`;
}

describe('withinOne', () => {
  it('accepts one substitution, insertion or deletion', () => {
    expect(withinOne('LOB-EN001', 'L0B-EN001')).toBe(true);
    expect(withinOne('LOB-EN001', 'LOB-EN01')).toBe(true);
    expect(withinOne('LOB-EN01', 'LOB-EN001')).toBe(true);
  });

  it('rejects equal strings and larger differences', () => {
    expect(withinOne('LOB-EN001', 'LOB-EN001')).toBe(false);
    expect(withinOne('LOB-EN001', 'L0B-EN0O1')).toBe(false);
    expect(withinOne('LOB-EN001', 'LOB-EN0')).toBe(false);
  });
});

describe('card database', () => {
  it('starts empty', async () => {
    const db = createCardDatabase([fakeSource('a', [BEWD]).source], freshIdb());
    await db.load();
    expect(db.subscriptions()).toEqual([]);
    expect(db.hasData()).toBe(false);
    expect(db.find('LOB-EN001')).toEqual([]);
  });

  it('subscribing downloads the data and records the subscription', async () => {
    const { source } = fakeSource('a', [BEWD, DM]);
    const db = createCardDatabase([source], freshIdb(), clock());
    await db.load();
    const phases: string[] = [];
    await db.subscribe('a', (phase) => phases.push(phase));

    expect(phases).toEqual(['downloading', 'saving']);
    expect(db.hasData()).toBe(true);
    expect(db.find('LOB-EN001')).toEqual([BEWD]);
    expect(db.subscriptions()).toEqual([
      {
        sourceId: 'a',
        version: '1',
        updatedAt: '2026-10-09T00:00:00.000Z',
        checkedAt: '2026-10-09T00:00:00.000Z',
        count: 2,
        lastError: null,
      },
    ]);
  });

  it('keeps data across app restarts', async () => {
    const idb = freshIdb();
    const { source } = fakeSource('a', [BEWD]);
    const first = createCardDatabase([source], idb);
    await first.load();
    await first.subscribe('a');

    const second = createCardDatabase([source], idb);
    await second.load();
    expect(second.find('LOB-EN001')).toEqual([BEWD]);
    expect(second.subscriptions()).toHaveLength(1);
  });

  it('rejects subscribing to an unknown source', async () => {
    const db = createCardDatabase([], freshIdb());
    await db.load();
    await expect(db.subscribe('nope')).rejects.toThrow(/unknown/i);
  });

  it('a failed first subscribe leaves nothing behind', async () => {
    const { source, state } = fakeSource('a', [BEWD]);
    state.fail = true;
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await expect(db.subscribe('a')).rejects.toThrow('offline');
    expect(db.subscriptions()).toEqual([]);
    expect(db.hasData()).toBe(false);
  });

  it('refuses an empty download', async () => {
    const { source } = fakeSource('a', []);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await expect(db.subscribe('a')).rejects.toThrow(/no cards/i);
    expect(db.subscriptions()).toEqual([]);
  });

  it('returns every rarity of a code', async () => {
    const { source } = fakeSource('a', [ULTRA, SECRET]);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await db.subscribe('a');
    expect(db.find('RA01-EN010')).toEqual([ULTRA, SECRET]);
  });

  it('searches all subscribed sources and returns identical printings once', async () => {
    const a = fakeSource('a', [BEWD]);
    const b = fakeSource('b', [BEWD, DM]);
    const db = createCardDatabase([a.source, b.source], freshIdb());
    await db.load();
    await db.subscribe('a');
    await db.subscribe('b');
    expect(db.find('LOB-EN001')).toEqual([BEWD]);
    expect(db.find('LOB-EN005')).toEqual([DM]);
  });

  it('unsubscribing removes only that source', async () => {
    const idb = freshIdb();
    const a = fakeSource('a', [BEWD]);
    const b = fakeSource('b', [DM]);
    const db = createCardDatabase([a.source, b.source], idb);
    await db.load();
    await db.subscribe('a');
    await db.subscribe('b');
    await db.unsubscribe('a');

    expect(db.find('LOB-EN001')).toEqual([]);
    expect(db.find('LOB-EN005')).toEqual([DM]);
    expect(db.subscriptions().map((s) => s.sourceId)).toEqual(['b']);

    const reopened = createCardDatabase([a.source, b.source], idb);
    await reopened.load();
    expect(reopened.find('LOB-EN001')).toEqual([]);
    expect(reopened.find('LOB-EN005')).toEqual([DM]);
  });

  it('checkForUpdates does not download when the version is unchanged', async () => {
    const { source, state } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], freshIdb(), clock());
    await db.load();
    await db.subscribe('a');
    const downloads = state.printingsCalls;

    const results = await db.checkForUpdates();

    expect(results).toEqual([{ sourceId: 'a', updated: false, added: 0, error: null }]);
    expect(state.printingsCalls).toBe(downloads);
    expect(db.subscriptions()[0].checkedAt).toBe('2026-10-09T00:00:01.000Z');
    expect(db.subscriptions()[0].updatedAt).toBe('2026-10-09T00:00:00.000Z');
  });

  it('checkForUpdates downloads a new version and counts new printings', async () => {
    const { source, state } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await db.subscribe('a');

    state.version = '2';
    state.printings = [BEWD, DM, ULTRA];
    const results = await db.checkForUpdates();

    expect(results).toEqual([{ sourceId: 'a', updated: true, added: 2, error: null }]);
    expect(db.find('LOB-EN005')).toEqual([DM]);
    expect(db.subscriptions()[0].version).toBe('2');
    expect(db.subscriptions()[0].count).toBe(3);
  });

  it('checkForUpdates with no connection keeps the data and reports the error without throwing', async () => {
    const idb = freshIdb();
    const { source, state } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], idb);
    await db.load();
    await db.subscribe('a');

    state.fail = true;
    const results = await db.checkForUpdates();

    expect(results).toEqual([{ sourceId: 'a', updated: false, added: 0, error: 'offline' }]);
    expect(db.find('LOB-EN001')).toEqual([BEWD]);
    expect(db.subscriptions()[0].lastError).toBe('offline');

    const reopened = createCardDatabase([source], idb);
    await reopened.load();
    expect(reopened.find('LOB-EN001')).toEqual([BEWD]);
    expect(reopened.subscriptions()[0].lastError).toBe('offline');
  });

  it('a successful check clears a previous error', async () => {
    const { source, state } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await db.subscribe('a');
    state.fail = true;
    await db.checkForUpdates();
    state.fail = false;
    await db.checkForUpdates();
    expect(db.subscriptions()[0].lastError).toBeNull();
  });

  it('checkForUpdates survives a subscription whose source no longer exists', async () => {
    const idb = freshIdb();
    const { source } = fakeSource('a', [BEWD]);
    const first = createCardDatabase([source], idb);
    await first.load();
    await first.subscribe('a');

    const later = createCardDatabase([], idb);
    await later.load();
    const results = await later.checkForUpdates();
    expect(results[0].updated).toBe(false);
    expect(results[0].error).toMatch(/unknown/i);
    expect(later.find('LOB-EN001')).toEqual([BEWD]);
  });

  it('forceRefresh downloads even when the version is unchanged', async () => {
    const { source, state } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await db.subscribe('a');

    state.printings = [BEWD, DM];
    await db.forceRefresh('a');

    expect(db.find('LOB-EN005')).toEqual([DM]);
    expect(db.subscriptions()[0].count).toBe(2);
  });

  it('a failed forceRefresh keeps the old data and records the error', async () => {
    const { source, state } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await db.subscribe('a');

    state.fail = true;
    await expect(db.forceRefresh('a')).rejects.toThrow('offline');

    expect(db.find('LOB-EN001')).toEqual([BEWD]);
    expect(db.subscriptions()[0].lastError).toBe('offline');
    expect(db.subscriptions()[0].version).toBe('1');
  });

  it('forceRefresh requires a subscription', async () => {
    const { source } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await expect(db.forceRefresh('a')).rejects.toThrow(/not subscribed/i);
  });

  it('an update check that finishes after an unsubscribe does not bring the subscription back', async () => {
    const idb = freshIdb();
    const { source, state } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], idb);
    await db.load();
    await db.subscribe('a');

    const slow = gate();
    state.hold = slow.wait;
    const check = db.checkForUpdates();
    const unsubscribe = db.unsubscribe('a');
    slow.open();
    await Promise.all([check, unsubscribe]);

    expect(db.subscriptions()).toEqual([]);
    expect(db.hasData()).toBe(false);
    const reopened = createCardDatabase([source], idb);
    await reopened.load();
    expect(reopened.subscriptions()).toEqual([]);
  });

  it('a force refresh that overlaps an update check is not overwritten by it', async () => {
    const { source, state } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await db.subscribe('a');

    const slow = gate();
    state.hold = slow.wait;
    const check = db.checkForUpdates();
    state.version = '2';
    state.printings = [BEWD, DM];
    const refresh = db.forceRefresh('a');
    slow.open();
    await Promise.all([check, refresh]);

    expect(db.subscriptions()[0].version).toBe('2');
    expect(db.subscriptions()[0].count).toBe(2);
  });

  it('two subscribes to the same source at once download once', async () => {
    const { source, state } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await Promise.all([db.subscribe('a'), db.subscribe('a')]);
    expect(state.printingsCalls).toBe(1);
    expect(db.subscriptions()).toHaveLength(1);
  });

  it('reports the running activity of a source and notifies listeners', async () => {
    const { source, state } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    let notified = 0;
    const stopListening = db.onChange(() => notified++);

    const slow = gate();
    state.hold = slow.wait;
    expect(db.activity('a')).toBeNull();
    const subscribing = db.subscribe('a');
    expect(db.activity('a')).toBe('downloading');
    slow.open();
    await subscribing;

    expect(db.activity('a')).toBeNull();
    expect(notified).toBeGreaterThan(0);
    stopListening();
    const before = notified;
    await db.forceRefresh('a');
    expect(notified).toBe(before);
  });

  it('remembers why a first subscribe failed until the next attempt succeeds', async () => {
    const { source, state } = fakeSource('a', [BEWD]);
    state.fail = true;
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    expect(db.failure('a')).toBeNull();
    await expect(db.subscribe('a')).rejects.toThrow('offline');
    expect(db.failure('a')).toBe('offline');
    expect(db.activity('a')).toBeNull();

    state.fail = false;
    await db.subscribe('a');
    expect(db.failure('a')).toBeNull();
  });

  it('suggests up to five known codes one edit away, sorted', async () => {
    const codes = ['LOB-EN001', 'LOB-EN002', 'LOB-EN003', 'LOB-EN004', 'LOB-EN005', 'LOB-EN006', 'SDK-001'];
    const printings = codes.map((code, i) => ({ code, cardId: i + 1, name: code, setName: 'S', rarity: 'Common' }));
    const { source } = fakeSource('a', printings);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await db.subscribe('a');

    expect(db.suggest('LOB-EN00X')).toEqual(['LOB-EN001', 'LOB-EN002', 'LOB-EN003', 'LOB-EN004', 'LOB-EN005']);
    expect(db.suggest('L0B-EN001')).toEqual(['LOB-EN001']);
    expect(db.suggest('ZZZ-EN999')).toEqual([]);
  });
});

describe('card names', () => {
  function named() {
    const fake = fakeSource('a', [BEWD, DM]);
    fake.state.languages = ['French', 'German'];
    fake.state.names = {
      French: [[1, 'Dragon Blanc aux Yeux Bleus'], [2, 'Magicien Sombre'], [99, 'Carte Inconnue']],
      German: [[1, 'Blauäugiger w. Drache']],
    };
    return fake;
  }

  it('finds a card by its English name with no names downloaded', async () => {
    const db = createCardDatabase([fakeSource('a', [BEWD, DM]).source], freshIdb(), clock());
    await db.load();
    await db.subscribe('a');
    expect(db.findByName('Dark Magician')).toMatchObject({ cardId: 2, language: 'English' });
  });

  it('finds nothing by name while empty', async () => {
    const db = createCardDatabase([named().source], freshIdb(), clock());
    await db.load();
    expect(db.findByName('Dark Magician')).toBeNull();
    expect(db.printingsOf(1)).toEqual([]);
  });

  it('downloads the names of each language, one after the other, on subscribe', async () => {
    const { source, state } = named();
    const db = createCardDatabase([source], freshIdb(), clock());
    await db.load();
    await db.subscribe('a');
    expect(state.namesCalls).toEqual(['French', 'German']);
    expect(db.findByName('Magicien Sombre')).toMatchObject({ cardId: 2, language: 'French' });
    expect(db.findByName('Blauaugiger w. Drache')).toMatchObject({ cardId: 1, language: 'German' });
  });

  it('ignores names of cards that have no printing', async () => {
    const db = createCardDatabase([named().source], freshIdb(), clock());
    await db.load();
    await db.subscribe('a');
    expect(db.findByName('Carte Inconnue')).toBeNull();
  });

  it('gives the printings of a card', async () => {
    const db = createCardDatabase([fakeSource('a', [BEWD, ULTRA, SECRET]).source], freshIdb(), clock());
    await db.load();
    await db.subscribe('a');
    expect(db.printingsOf(3)).toEqual([ULTRA, SECRET]);
    expect(db.printingsOf(12345)).toEqual([]);
  });

  it('keeps names across a reload', async () => {
    const idb = freshIdb();
    const { source } = named();
    const first = createCardDatabase([source], idb, clock());
    await first.load();
    await first.subscribe('a');
    const second = createCardDatabase([source], idb, clock());
    await second.load();
    expect(second.findByName('Magicien Sombre')).toMatchObject({ cardId: 2 });
  });

  it('keeps the other languages when one fails, and the subscription succeeds', async () => {
    const { source, state } = named();
    state.failNames.add('French');
    const db = createCardDatabase([source], freshIdb(), clock());
    await db.load();
    await db.subscribe('a');
    expect(db.subscriptions()[0].lastError).toBeNull();
    expect(db.find('LOB-EN001')).toEqual([BEWD]);
    expect(db.findByName('Magicien Sombre')).toBeNull();
    expect(db.findByName('Blauaugiger w. Drache')).toMatchObject({ cardId: 1 });
  });

  it('fetches a missing language at the next update check, and only that one', async () => {
    const { source, state } = named();
    state.failNames.add('French');
    const db = createCardDatabase([source], freshIdb(), clock());
    await db.load();
    await db.subscribe('a');
    state.failNames.clear();
    state.namesCalls.length = 0;
    const results = await db.checkForUpdates();
    expect(results).toEqual([{ sourceId: 'a', updated: false, added: 0, error: null }]);
    expect(state.namesCalls).toEqual(['French']);
    expect(state.printingsCalls).toBe(1);
    expect(db.findByName('Magicien Sombre')).toMatchObject({ cardId: 2 });
  });

  it('fetches nothing at an update check when every language is present', async () => {
    const { source, state } = named();
    const db = createCardDatabase([source], freshIdb(), clock());
    await db.load();
    await db.subscribe('a');
    state.namesCalls.length = 0;
    await db.checkForUpdates();
    expect(state.namesCalls).toEqual([]);
  });

  it('keeps the old names when a refresh cannot fetch them', async () => {
    const { source, state } = named();
    const db = createCardDatabase([source], freshIdb(), clock());
    await db.load();
    await db.subscribe('a');
    state.failNames.add('French');
    await db.forceRefresh('a');
    expect(db.findByName('Magicien Sombre')).toMatchObject({ cardId: 2 });
  });

  it('removes names on unsubscribe', async () => {
    const idb = freshIdb();
    const { source } = named();
    const db = createCardDatabase([source], idb, clock());
    await db.load();
    await db.subscribe('a');
    await db.unsubscribe('a');
    expect(db.findByName('Magicien Sombre')).toBeNull();
    const again = createCardDatabase([source], idb, clock());
    await again.load();
    expect(again.findByName('Magicien Sombre')).toBeNull();
  });
});

describe('data saved before names existed', () => {
  // Writes a version 1 database by hand: two stores, printings without card ids.
  async function versionOne(idb: IDBFactory): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open('ygo-scanner', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('subscriptions', { keyPath: 'sourceId' });
        request.result.createObjectStore('printings');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['subscriptions', 'printings'], 'readwrite');
    transaction.objectStore('subscriptions').put({ sourceId: 'a', version: '1', updatedAt: 't', checkedAt: 't', count: 1, lastError: null });
    transaction.objectStore('printings').put([{ code: 'LOB-EN001', name: 'Blue-Eyes White Dragon', setName: 'LOB', rarity: 'Ultra Rare' }], 'a');
    await new Promise<void>((resolve) => (transaction.oncomplete = () => resolve()));
    db.close();
  }

  it('loads version 1 data and still finds cards by code', async () => {
    const idb = freshIdb();
    await versionOne(idb);
    const db = createCardDatabase([fakeSource('a', [BEWD]).source], idb, clock());
    await db.load();
    expect(db.hasData()).toBe(true);
    expect(db.find('LOB-EN001')).toEqual([{ ...BEWD, cardId: 0 }]);
    expect(db.findByName('Blue-Eyes White Dragon')).toBeNull();
    expect(db.printingsOf(0)).toEqual([]);
  });

  it('downloads the cards again at the next update check, though the version is the same', async () => {
    const idb = freshIdb();
    await versionOne(idb);
    const { source, state } = fakeSource('a', [BEWD]);
    const db = createCardDatabase([source], idb, clock());
    await db.load();
    const results = await db.checkForUpdates();
    expect(results[0]).toMatchObject({ updated: true, error: null });
    expect(state.printingsCalls).toBe(1);
    expect(db.find('LOB-EN001')).toEqual([BEWD]);
    expect(db.findByName('Blue-Eyes White Dragon')).toMatchObject({ cardId: 1 });
  });

  it('keeps working by code when that download fails', async () => {
    const idb = freshIdb();
    await versionOne(idb);
    const { source, state } = fakeSource('a', [BEWD]);
    state.fail = true;
    const db = createCardDatabase([source], idb, clock());
    await db.load();
    await db.checkForUpdates();
    expect(db.find('LOB-EN001')).toHaveLength(1);
  });
});
