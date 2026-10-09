import { CODE_PATTERN, LANGUAGES, type Language } from './setCode';

export const STORAGE_KEY = 'ygo-scanner.collection.v1';

export type Entry = {
  code: string; // as printed, e.g. "LOB-FR001"
  matchedCode: string; // code matched in the database, e.g. "LOB-EN001"
  language: Language;
  name: string;
  setName: string;
  rarity: string;
  quantity: number;
  addedAt: string; // ISO timestamp
};

export type NewEntry = Omit<Entry, 'quantity' | 'addedAt'>;

export type Collection = ReturnType<typeof createCollection>;

export function entryKey(entry: Pick<Entry, 'code' | 'language' | 'rarity'>): string {
  return `${entry.code}|${entry.language}|${entry.rarity}`;
}

export function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === 'string' &&
    CODE_PATTERN.test(v.code) &&
    typeof v.matchedCode === 'string' &&
    typeof v.language === 'string' &&
    (LANGUAGES as string[]).includes(v.language) &&
    typeof v.name === 'string' &&
    typeof v.setName === 'string' &&
    typeof v.rarity === 'string' &&
    typeof v.addedAt === 'string' &&
    typeof v.quantity === 'number' &&
    Number.isInteger(v.quantity) &&
    v.quantity >= 1
  );
}

export function createCollection(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now: () => string = () => new Date().toISOString(),
) {
  let entries: Entry[] = read();

  function read(): Entry[] {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  function commit(next: Entry[]): boolean {
    entries = next;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(entries));
      return true;
    } catch {
      return false;
    }
  }

  function withAdded(list: Entry[], incoming: Entry): Entry[] {
    const key = entryKey(incoming);
    if (list.some((e) => entryKey(e) === key)) {
      return list.map((e) => (entryKey(e) === key ? { ...e, quantity: e.quantity + incoming.quantity } : e));
    }
    return [...list, incoming];
  }

  return {
    all(): Entry[] {
      return entries;
    },

    add(entry: NewEntry): boolean {
      return commit(withAdded(entries, { ...entry, quantity: 1, addedAt: now() }));
    },

    setQuantity(key: string, quantity: number): boolean {
      if (quantity < 1) return commit(entries.filter((e) => entryKey(e) !== key));
      return commit(entries.map((e) => (entryKey(e) === key ? { ...e, quantity } : e)));
    },

    remove(key: string): boolean {
      return commit(entries.filter((e) => entryKey(e) !== key));
    },

    replaceAll(next: Entry[]): boolean {
      return commit([...next]);
    },

    merge(incoming: Entry[]): boolean {
      return commit(incoming.reduce(withAdded, entries));
    },
  };
}
