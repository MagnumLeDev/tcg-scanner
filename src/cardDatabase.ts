import { buildNameIndex, type NameEntry, type NameIndex, type NameMatch } from './nameIndex';
import type { Language } from './setCode';
import type { CardName, Printing, Source } from './sources/types';

export type Subscription = {
  sourceId: string;
  version: string;
  updatedAt: string; // ISO timestamp of last successful download
  checkedAt: string; // ISO timestamp of last version check
  count: number;
  lastError: string | null;
};

export type UpdateResult = { sourceId: string; updated: boolean; added: number; error: string | null };

export type Phase = 'downloading' | 'saving';

export type CardDatabase = ReturnType<typeof createCardDatabase>;

const DB_NAME = 'ygo-scanner';
const SUBSCRIPTIONS = 'subscriptions';
const PRINTINGS = 'printings';
const NAMES = 'names';
const MAX_SUGGESTIONS = 5;

type StoredNames = Partial<Record<Language, CardName[]>>;

function openDatabase(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SUBSCRIPTIONS)) db.createObjectStore(SUBSCRIPTIONS, { keyPath: 'sourceId' });
      // One record per source: key = sourceId, value = Printing[].
      if (!db.objectStoreNames.contains(PRINTINGS)) db.createObjectStore(PRINTINGS);
      // One record per source: key = sourceId, value = names per language.
      if (!db.objectStoreNames.contains(NAMES)) db.createObjectStore(NAMES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Storage transaction aborted'));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function printingKey(p: Printing): string {
  return `${p.code}|${p.name}|${p.setName}|${p.rarity}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function withinOne(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export function createCardDatabase(
  sources: Source[],
  idb: IDBFactory,
  now: () => string = () => new Date().toISOString(),
) {
  const subscriptionsById = new Map<string, Subscription>();
  const printingsBySource = new Map<string, Printing[]>();
  let byCode = new Map<string, Printing[]>();
  const namesBySource = new Map<string, StoredNames>();
  let byCard = new Map<number, Printing[]>();
  let nameIndex: NameIndex = buildNameIndex([]);

  const activities = new Map<string, Phase>(); // what is running now, per source
  const failures = new Map<string, string>(); // why the last attempt failed, for sources with no subscription
  const downloads = new Map<string, Promise<void>>(); // user-requested download in flight, per source
  const queues = new Map<string, Promise<unknown>>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  // Operations on one source run one after another, so a slow update check can
  // never write over an unsubscribe or a refresh that happened in the meantime.
  function enqueue<T>(sourceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(sourceId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    queues.set(sourceId, next.catch(() => {}));
    return next;
  }

  function setActivity(sourceId: string, phase: Phase | null): void {
    if (phase) activities.set(sourceId, phase);
    else activities.delete(sourceId);
    notify();
  }

  function rebuildIndex(): void {
    byCode = new Map();
    byCard = new Map();
    const entries: NameEntry[] = [];
    const seen = new Set<string>();
    for (const printings of printingsBySource.values()) {
      for (const printing of printings) {
        const key = printingKey(printing);
        if (seen.has(key)) continue;
        seen.add(key);
        const list = byCode.get(printing.code);
        if (list) list.push(printing);
        else byCode.set(printing.code, [printing]);

        if (!printing.cardId) continue; // saved before names existed
        const ofCard = byCard.get(printing.cardId);
        if (ofCard) ofCard.push(printing);
        else {
          byCard.set(printing.cardId, [printing]);
          entries.push({ cardId: printing.cardId, name: printing.name, language: 'English' });
        }
      }
    }
    for (const names of namesBySource.values()) {
      for (const [language, list] of Object.entries(names) as [Language, CardName[]][]) {
        for (const [cardId, name] of list) {
          if (byCard.has(cardId)) entries.push({ cardId, name, language });
        }
      }
    }
    nameIndex = buildNameIndex(entries);
  }

  function sourceById(sourceId: string): Source {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) throw new Error(`Unknown database: ${sourceId}`);
    return source;
  }

  // Writes the subscription and, when given, its printings in one transaction,
  // so an interrupted write leaves the previous data intact.
  async function store(subscription: Subscription, printings: Printing[] | null): Promise<void> {
    const db = await openDatabase(idb);
    try {
      const transaction = db.transaction([SUBSCRIPTIONS, PRINTINGS], 'readwrite');
      transaction.objectStore(SUBSCRIPTIONS).put(subscription);
      if (printings) transaction.objectStore(PRINTINGS).put(printings, subscription.sourceId);
      await finished(transaction);
    } finally {
      db.close();
    }
  }

  function missingLanguages(sourceId: string): Language[] {
    const names = namesBySource.get(sourceId) ?? {};
    return sourceById(sourceId).nameLanguages.filter((language) => !names[language]);
  }

  // Fetches card names one language at a time: each answer is large. A language
  // that fails keeps what was there before and is tried again at the next
  // update check; names never stand in the way of scanning by code.
  async function downloadNames(sourceId: string, languages: Language[]): Promise<void> {
    if (languages.length === 0) return;
    const source = sourceById(sourceId);
    const names: StoredNames = { ...namesBySource.get(sourceId) };
    let changed = false;
    for (const language of languages) {
      try {
        const list = await source.fetchNames(language);
        if (list.length === 0) continue;
        names[language] = list;
        changed = true;
      } catch {
        // Tried again at the next update check.
      }
    }
    if (!changed) return;
    namesBySource.set(sourceId, names);
    rebuildIndex();
    notify();
    try {
      const db = await openDatabase(idb);
      try {
        const transaction = db.transaction([NAMES], 'readwrite');
        transaction.objectStore(NAMES).put(names, sourceId);
        await finished(transaction);
      } finally {
        db.close();
      }
    } catch {
      // The names still work for this session.
    }
  }

  async function download(sourceId: string, onProgress?: (phase: Phase) => void): Promise<number> {
    const source = sourceById(sourceId);
    setActivity(sourceId, 'downloading');
    onProgress?.('downloading');
    const [version, printings] = await Promise.all([source.fetchVersion(), source.fetchPrintings()]);
    if (printings.length === 0) throw new Error('The database returned no cards');

    setActivity(sourceId, 'saving');
    onProgress?.('saving');
    const previous = new Set((printingsBySource.get(sourceId) ?? []).map(printingKey));
    const added = printings.filter((p) => !previous.has(printingKey(p))).length;
    const timestamp = now();
    const subscription: Subscription = {
      sourceId,
      version,
      updatedAt: timestamp,
      checkedAt: timestamp,
      count: printings.length,
      lastError: null,
    };
    await store(subscription, printings);

    subscriptionsById.set(sourceId, subscription);
    printingsBySource.set(sourceId, printings);
    rebuildIndex();
    notify(); // cards can be scanned by code while the names are still coming

    setActivity(sourceId, 'downloading');
    await downloadNames(sourceId, source.nameLanguages);
    return added;
  }

  async function recordError(sourceId: string, message: string): Promise<void> {
    const subscription = subscriptionsById.get(sourceId);
    if (!subscription) return;
    const next = { ...subscription, lastError: message };
    subscriptionsById.set(sourceId, next);
    try {
      await store(next, null);
    } catch {
      // The error is still visible in memory for this session.
    }
  }

  // A second request for a source that is already downloading joins the first.
  function requestDownload(sourceId: string, onProgress?: (phase: Phase) => void): Promise<void> {
    const running = downloads.get(sourceId);
    if (running) return running;

    setActivity(sourceId, 'downloading');
    const promise = enqueue(sourceId, async () => {
      failures.delete(sourceId);
      try {
        await download(sourceId, onProgress);
      } catch (error) {
        const message = messageOf(error);
        if (subscriptionsById.has(sourceId)) await recordError(sourceId, message);
        else failures.set(sourceId, message);
        throw error;
      } finally {
        downloads.delete(sourceId);
        setActivity(sourceId, null);
      }
    });
    downloads.set(sourceId, promise);
    return promise;
  }

  return {
    async load(): Promise<void> {
      const db = await openDatabase(idb);
      try {
        const transaction = db.transaction([SUBSCRIPTIONS, PRINTINGS, NAMES], 'readonly');
        // All requests are issued before the first await: an IndexedDB transaction
        // closes itself once control returns to the event loop with nothing pending.
        const [stored, keys, values, nameKeys, nameValues] = await Promise.all([
          result<Subscription[]>(transaction.objectStore(SUBSCRIPTIONS).getAll()),
          result<IDBValidKey[]>(transaction.objectStore(PRINTINGS).getAllKeys()),
          result<Printing[][]>(transaction.objectStore(PRINTINGS).getAll()),
          result<IDBValidKey[]>(transaction.objectStore(NAMES).getAllKeys()),
          result<StoredNames[]>(transaction.objectStore(NAMES).getAll()),
        ]);
        const savedPrintings = new Map(keys.map((key, i) => [String(key), values[i]]));
        const savedNames = new Map(nameKeys.map((key, i) => [String(key), nameValues[i]]));
        subscriptionsById.clear();
        printingsBySource.clear();
        namesBySource.clear();
        for (const subscription of stored) {
          subscriptionsById.set(subscription.sourceId, subscription);
          // Data saved before names existed has no card ids; 0 marks it for a new download.
          const printings = (savedPrintings.get(subscription.sourceId) ?? []).map((p) => (p.cardId ? p : { ...p, cardId: 0 }));
          printingsBySource.set(subscription.sourceId, printings);
          const names = savedNames.get(subscription.sourceId);
          if (names) namesBySource.set(subscription.sourceId, names);
        }
      } finally {
        db.close();
      }
      rebuildIndex();
    },

    subscriptions(): Subscription[] {
      return [...subscriptionsById.values()];
    },

    // What is running for a source right now, or null.
    activity(sourceId: string): Phase | null {
      return activities.get(sourceId) ?? null;
    },

    // Why the last subscribe attempt failed, for a source that is not subscribed.
    failure(sourceId: string): string | null {
      return failures.get(sourceId) ?? null;
    },

    // Calls the listener whenever an activity starts, changes phase, or ends.
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    subscribe(sourceId: string, onProgress?: (phase: Phase) => void): Promise<void> {
      return requestDownload(sourceId, onProgress);
    },

    unsubscribe(sourceId: string): Promise<void> {
      return enqueue(sourceId, async () => {
        const db = await openDatabase(idb);
        try {
          const transaction = db.transaction([SUBSCRIPTIONS, PRINTINGS, NAMES], 'readwrite');
          transaction.objectStore(SUBSCRIPTIONS).delete(sourceId);
          transaction.objectStore(PRINTINGS).delete(sourceId);
          transaction.objectStore(NAMES).delete(sourceId);
          await finished(transaction);
        } finally {
          db.close();
        }
        subscriptionsById.delete(sourceId);
        printingsBySource.delete(sourceId);
        namesBySource.delete(sourceId);
        failures.delete(sourceId);
        rebuildIndex();
        notify();
      });
    },

    async checkForUpdates(): Promise<UpdateResult[]> {
      const results: UpdateResult[] = [];
      for (const { sourceId } of [...subscriptionsById.values()]) {
        await enqueue(sourceId, async () => {
          const subscription = subscriptionsById.get(sourceId);
          if (!subscription) return; // unsubscribed while this check was waiting its turn
          try {
            const version = await sourceById(sourceId).fetchVersion();
            const outdated = (printingsBySource.get(sourceId) ?? []).some((p) => !p.cardId);
            if (version === subscription.version && !outdated) {
              const next = { ...subscription, checkedAt: now(), lastError: null };
              await store(next, null);
              subscriptionsById.set(sourceId, next);
              const missing = missingLanguages(sourceId);
              if (missing.length > 0) setActivity(sourceId, 'downloading');
              await downloadNames(sourceId, missing);
              results.push({ sourceId, updated: false, added: 0, error: null });
            } else {
              const added = await download(sourceId);
              results.push({ sourceId, updated: true, added, error: null });
            }
          } catch (error) {
            const message = messageOf(error);
            await recordError(sourceId, message);
            results.push({ sourceId, updated: false, added: 0, error: message });
          } finally {
            setActivity(sourceId, null);
          }
        });
      }
      return results;
    },

    async forceRefresh(sourceId: string, onProgress?: (phase: Phase) => void): Promise<void> {
      if (!subscriptionsById.has(sourceId)) throw new Error(`Not subscribed to ${sourceId}`);
      await requestDownload(sourceId, onProgress);
    },

    hasData(): boolean {
      return byCode.size > 0;
    },

    find(code: string): Printing[] {
      return byCode.get(code) ?? [];
    },

    suggest(code: string): string[] {
      const near: string[] = [];
      for (const known of byCode.keys()) {
        if (withinOne(code, known)) near.push(known);
      }
      return near.sort().slice(0, MAX_SUGGESTIONS);
    },

    // The card a name read by the camera most probably belongs to, in any language held.
    findByName(text: string): NameMatch | null {
      return nameIndex.find(text);
    },

    printingsOf(cardId: number): Printing[] {
      return byCard.get(cardId) ?? [];
    },
  };
}
