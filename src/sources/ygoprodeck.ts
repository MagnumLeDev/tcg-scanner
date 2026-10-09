import { CODE_PATTERN } from '../setCode';
import type { Printing, Source } from './types';

const API = 'https://db.ygoprodeck.com/api/v7';

type RawSet = { set_name?: unknown; set_code?: unknown; set_rarity?: unknown };
type RawCard = { name?: unknown; card_sets?: unknown };

export function flatten(json: unknown): Printing[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error('Unexpected card data format');

  const printings: Printing[] = [];
  const seen = new Set<string>();
  for (const card of data as RawCard[]) {
    if (typeof card?.name !== 'string' || !Array.isArray(card.card_sets)) continue;
    for (const set of card.card_sets as RawSet[]) {
      if (typeof set?.set_code !== 'string' || !CODE_PATTERN.test(set.set_code)) continue;
      const printing: Printing = {
        code: set.set_code,
        name: card.name,
        setName: typeof set.set_name === 'string' ? set.set_name : '',
        rarity: typeof set.set_rarity === 'string' ? set.set_rarity : '',
      };
      const key = `${printing.code}|${printing.name}|${printing.setName}|${printing.rarity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      printings.push(printing);
    }
  }
  return printings;
}

const VERSION_TIMEOUT_MS = 20_000;
const CARDS_TIMEOUT_MS = 180_000;

// Every request has a deadline: without one, a dead connection would leave the
// database row in Settings busy forever.
async function getJson(path: string, what: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API}/${path}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`${what} failed (HTTP ${response.status})`);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${what} timed out. Check your connection and try again.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const ygoprodeck: Source = {
  id: 'ygoprodeck',
  name: 'YGOPRODeck — all Yu-Gi-Oh! TCG cards',

  async fetchVersion() {
    const json = await getJson('checkDBVer.php', 'Version check', VERSION_TIMEOUT_MS);
    const version = (json as { database_version?: unknown }[] | null)?.[0]?.database_version;
    if (typeof version !== 'string') throw new Error('Unexpected version format');
    return version;
  },

  async fetchPrintings() {
    return flatten(await getJson('cardinfo.php', 'Card download', CARDS_TIMEOUT_MS));
  },
};
