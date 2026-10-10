# Card Name Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every scan also reads the card name, and the name and the set code together pick the most probable card in the database.

**Architecture:** The card source supplies card ids and names in four more languages; the card database stores them and builds an in-memory name index. The whole-picture reading also reads the name line. The detector combines code and name across readings, and the result panel can open on a card that has no code yet.

**Tech Stack:** TypeScript, React 19, Vite 8, Vitest 5, onnxruntime-web (PP-OCRv4), IndexedDB (fake-indexeddb in tests), playwright-core (dev only, replay harness).

**Spec:** `docs/superpowers/specs/2026-10-10-card-name-matching-design.md`

## Global Constraints

- Work on branch `card-name-matching`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No new runtime dependency. `playwright-core` is a devDependency used only by `scripts/replay.mjs`.
- Name languages: French, German, Italian, Portuguese, plus English from the printings. Fetched one after the other, never in parallel.
- Name match thresholds: score ≥ 0.8, normalised length ≥ 4, lead over the best different card ≥ 0.1.
- Name lines: box centre in the top 22 % of the picture, box at least 35 % of its width, the two widest, read at a maximum line width of 640.
- The detector remembers a name for 3 readings (`reading - at < 3`), the same window as for codes.
- Performance targets: average time per reading up by at most 15 %; a name lookup under 5 ms; index build under 300 ms.
- A failed or missing name download must never stop scanning by code.
- No regular-expression lookbehind (breaks on older iOS).
- Comments are plain sentences that say why, as in the existing code. Match existing naming (`recognise`, `normalise`).
- Run `npx tsc --noEmit` and `npm test` before every commit; both must pass.

## Review Focus

1. **Data saved before this change (printings without `cardId`), phone offline:** scanning by code must work exactly as before. Pinned in Task 4 (`loads version 1 data`) and Task 7 (`old data without card ids`).
2. **A dismissed card still in front of the camera:** it must not reopen through its name after being dismissed through its code. Pinned in Task 7 (`does not reopen a dismissed card by its name`).
3. **Text at the top of the picture that is not a name** (`[CARTE MAGIE]`, background print): must never produce a detection. Pinned in Task 3 (`returns nothing for text that is no card name`) and Task 7 (`ignores a name that matches nothing`).
4. **Two cards with near-identical names**, or one name inside many longer ones ("Dark Magician"): must not pick the wrong card. Pinned in Task 3 (`refuses to choose between two close names`, `finds a short name among many longer ones`).
5. **One language failing to download:** the others are kept and the failed one is retried at the next update check. Pinned in Task 4 (`keeps the other languages when one fails`, `fetches a missing language at the next update check`).

## File Structure

| File | Responsibility |
|---|---|
| `src/sources/types.ts` (modify) | `Printing.cardId`, `CardName`, `Source.nameLanguages`, `Source.fetchNames` |
| `src/sources/ygoprodeck.ts` (modify) | card id on printings, names per language |
| `src/nameIndex.ts` (create) | pure: normalise, edit distance, index, best card for a read name |
| `src/cardDatabase.ts` (modify) | store names, IndexedDB version 2, `findByName`, `printingsOf` |
| `src/ocr/decode.ts` (modify) | `Reading` type |
| `src/ocr/textBoxes.ts` (modify) | `nameBoxes`: which boxes are name lines |
| `src/ocr/ocr.ts` (modify) | read name lines, return `Reading`, `restart` |
| `src/setCode.ts` (modify) | `printedCode`: database code → code as printed in a language |
| `src/detector.ts` (modify) | combine code and name |
| `src/ui/ResultPanel.tsx` (modify) | open on a card with no code |
| `src/ui/ScanScreen.tsx` (modify) | wire detections, show names in details |
| `replay.html`, `src/replay.ts`, `scripts/replay.mjs`, `scripts/replay-pictures.json` (create) | replay the pictures in `../ressources` through the real pipeline; dev only, not part of the build |

---

### Task 1: Replay harness and baseline

Runs the photos in `/home/maxime/projects/ressources` through the reader and detector in a headless browser, and records how long a reading takes **before** any change.

**Files:**
- Create: `replay.html`, `src/replay.ts`, `scripts/replay.mjs`, `scripts/replay-pictures.json`
- Modify: `src/ocr/ocr.ts` (add `restart`), `package.json` (script + devDependency)

**Interfaces:**
- Produces: `restart(): void` exported from `src/ocr/ocr.ts`; `window.replay(pictureUrl: string, card: Rect): Promise<Result>` on the replay page; `npm run replay`.

- [ ] **Step 1: Add `restart` to the reader**

In `src/ocr/ocr.ts`, after `let closeUpNext = false;`:

```ts
// Makes the next reading a whole-picture one, so that replays always start the same way.
export function restart(): void {
  closeUpNext = false;
}
```

- [ ] **Step 2: Install the browser driver**

Run: `npm install --save-dev playwright-core`

- [ ] **Step 3: Write the replay page**

`replay.html` (project root; Vite serves it in dev, and the build ignores it because only `index.html` is an entry):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Replay</title>
  </head>
  <body>
    <script type="module" src="/src/replay.ts"></script>
  </body>
</html>
```

`src/replay.ts`:

```ts
// Development only: runs saved pictures through the same reader, database and
// detector as the Scan screen, so that changes can be measured on real cards.
import { createCardDatabase } from './cardDatabase';
import { match } from './cardMatch';
import { createDetector } from './detector';
import { prepare, recognise, restart } from './ocr/ocr';
import { SOURCES } from './sources';

type Rect = { x: number; y: number; width: number; height: number }; // fractions of the picture

const READINGS = 4; // whole picture, close-up, whole picture, close-up
const CROP_WIDTH = 1000; // about what the phone camera gives for the outline

const db = createCardDatabase(SOURCES, indexedDB);

const ready = (async () => {
  await db.load();
  if (!db.hasData()) await db.subscribe(SOURCES[0].id);
  await prepare();
})();

// The same area the Scan screen reads: the outline and a little around it.
function crop(image: HTMLImageElement, card: Rect): HTMLCanvasElement {
  const x = Math.max(0, (card.x - card.width * 0.08) * image.width);
  const y = Math.max(0, (card.y - card.height * 0.06) * image.height);
  const width = Math.min(image.width - x, card.width * 1.16 * image.width);
  const height = Math.min(image.height - y, card.height * 1.12 * image.height);
  const canvas = document.createElement('canvas');
  canvas.width = CROP_WIDTH;
  canvas.height = Math.round((CROP_WIDTH * height) / width);
  canvas.getContext('2d')!.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function replay(pictureUrl: string, card: Rect) {
  await ready;
  const image = new Image();
  image.src = pictureUrl;
  await image.decode();
  const canvas = crop(image, card);

  restart();
  const detector = createDetector((code) => match(db, code));
  const readings = [];
  let detected: string | null = null;
  for (let i = 0; i < READINGS; i++) {
    const started = performance.now();
    const lines = await recognise(canvas);
    const milliseconds = Math.round(performance.now() - started);
    readings.push({ milliseconds, codes: lines.map((line) => `${line.text} (${Math.round(line.confidence * 100)}%)`) });
    detected ??= detector.feed(lines)?.code ?? null;
  }
  return { detected, readings };
}

(window as unknown as { replay: typeof replay }).replay = replay;
```


- [ ] **Step 4: Describe the pictures**

`scripts/replay-pictures.json`: one entry per photo in `../ressources` (the two `.png` files are screenshots of the app, not card photos; leave them out). `card` is the card's rectangle as fractions of the picture. Open each photo with the Read tool and estimate the four card edges; the first entry is measured already and shows the precision needed (two decimals).

```json
[
  { "file": "IMG_9750.jpg", "card": { "x": 0.15, "y": 0.21, "width": 0.65, "height": 0.66 }, "code": "RA01-FR051", "name": "Renfort de l'Armée" }
]
```

Add `IMG_9751.jpg` to `IMG_9756.jpg` the same way. For `code` and `name`, write what you can read on the photo; write `null` when you cannot read it with certainty. These are provisional until Maxime confirms them in Task 9.

- [ ] **Step 5: Write the runner**

`scripts/replay.mjs`:

```js
// Replays the pictures listed in replay-pictures.json through the app's reader
// in a headless browser and prints what was read, what was detected and how long it took.
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const PICTURES = new URL('../../ressources/', import.meta.url).pathname;
const pictures = JSON.parse(await readFile(new URL('./replay-pictures.json', import.meta.url), 'utf8'));

// Uses whichever Chromium Playwright has already downloaded on this machine.
async function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const versions = (await readdir(cache)).filter((name) => /^chromium-\d+$/.test(name)).sort();
  if (versions.length === 0) throw new Error(`No Chromium in ${cache}. Set CHROMIUM to a browser executable.`);
  const folder = join(cache, versions.at(-1));
  const inner = (await readdir(folder)).find((name) => name.startsWith('chrome-linux'));
  return join(folder, inner, 'chrome');
}

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
// A kept profile, so the card database is downloaded once and not on every run.
const context = await chromium.launchPersistentContext('node_modules/.cache/replay-profile', {
  executablePath: await findChromium(),
  headless: true,
});

let failures = 0;
const times = [];
try {
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('page error:', error.message));
  await page.route('**/pictures/*', async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    await route.fulfill({ body: await readFile(join(PICTURES, name)), contentType: 'image/jpeg' });
  });
  await page.goto('http://localhost:5199/replay.html');
  await page.waitForFunction(() => typeof window.replay === 'function');

  for (const picture of pictures) {
    const result = await page.evaluate(([url, card]) => window.replay(url, card), [`/pictures/${picture.file}`, picture.card]);
    const ok = picture.code === null || result.detected === picture.code;
    if (!ok) failures++;
    console.log(`\n${picture.file}  expected ${picture.code ?? '?'} / ${picture.name ?? '?'}`);
    console.log(`  detected: ${JSON.stringify(result.detected)}  ${ok ? 'OK' : 'MISSED'}`);
    for (const reading of result.readings) {
      times.push(reading.milliseconds);
      console.log(`  ${reading.milliseconds} ms  ${JSON.stringify(reading)}`);
    }
  }
} finally {
  await context.close();
  await server.close();
}

const average = Math.round(times.reduce((sum, time) => sum + time, 0) / times.length);
console.log(`\n${pictures.length - failures}/${pictures.length} detected, average ${average} ms per reading`);
```

In `package.json` scripts add: `"replay": "node scripts/replay.mjs"`.

- [ ] **Step 6: Run it and record the baseline**

Run: `npm run replay` (the first run downloads the card database; allow two minutes)
Expected: one block per picture and a last line like `N/7 detected, average M ms per reading`. Some pictures are expected to be MISSED; `IMG_9755.jpg` is a known miss.

Run it twice more and note the three averages. Add this section at the end of this plan file, with the real numbers:

```markdown
## Baseline (Task 1)

Before any change: N/7 detected; average per reading M1, M2, M3 ms (three runs).
```

- [ ] **Step 7: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all pass; `dist/` contains no `replay.html`.

```bash
git add replay.html src/replay.ts scripts/replay.mjs scripts/replay-pictures.json src/ocr/ocr.ts package.json package-lock.json docs/superpowers/plans/2026-10-10-card-name-matching.md
git commit -m "Add a replay of saved card pictures through the reader"
```

---

### Task 2: Card ids and names from the source

**Files:**
- Modify: `src/sources/types.ts`, `src/sources/ygoprodeck.ts`
- Test: `src/sources/ygoprodeck.test.ts`
- Modify (fixtures only): every test file that builds a `Printing`

**Interfaces:**
- Produces:
  ```ts
  type Printing = { code: string; cardId: number; name: string; setName: string; rarity: string };
  type CardName = [cardId: number, name: string];
  type Source = { id; name; fetchVersion(); fetchPrintings(); nameLanguages: Language[]; fetchNames(language: Language): Promise<CardName[]> };
  ```
  `cardId` is `0` only for data saved before this change (Task 4 sets it); sources always give a real id.

- [ ] **Step 1: Write the failing tests**

In `src/sources/ygoprodeck.test.ts`, change the import to `import { flatten, names, ygoprodeck } from './ygoprodeck';`, add `cardId` to the expected printings of the existing `produces one printing per card-and-set entry` test:

```ts
    expect(flatten(SAMPLE)).toEqual([
      { code: 'LOB-EN001', cardId: 89631139, name: 'Blue-Eyes White Dragon', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare' },
      { code: 'SDK-001', cardId: 89631139, name: 'Blue-Eyes White Dragon', setName: 'Starter Deck: Kaiba', rarity: 'Ultra Rare' },
      { code: 'RA01-EN010', cardId: 1, name: 'Two Rarities', setName: 'Some Set', rarity: 'Ultra Rare' },
      { code: 'RA01-EN010', cardId: 1, name: 'Two Rarities', setName: 'Some Set', rarity: 'Secret Rare' },
    ]);
```

and add:

```ts
describe('flatten card ids', () => {
  it('skips a card that has no numeric id', () => {
    const json = { data: [{ name: 'No Id', card_sets: [{ set_name: 'S', set_code: 'LOB-EN002', set_rarity: 'Common' }] }] };
    expect(flatten(json)).toEqual([]);
  });
});

describe('names', () => {
  it('keeps the id and name of each card', () => {
    const json = { data: [{ id: 89631139, name: 'Dragon Blanc aux Yeux Bleus', desc: 'long text' }, { id: 1, name: 'Deux Raretés' }] };
    expect(names(json)).toEqual([[89631139, 'Dragon Blanc aux Yeux Bleus'], [1, 'Deux Raretés']]);
  });

  it('skips entries without an id or a name', () => {
    expect(names({ data: [{ id: 5 }, { name: 'x' }, null, { id: 6, name: '' }] })).toEqual([]);
  });

  it('rejects data in an unexpected format', () => {
    expect(() => names({ error: 'no' })).toThrow('Unexpected card data format');
  });
});

describe('fetchNames', () => {
  it('asks for the language and returns its names', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 7, name: 'Magicien Sombre' }] })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await ygoprodeck.fetchNames('French')).toEqual([[7, 'Magicien Sombre']]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('cardinfo.php?language=fr');
  });

  it('has names in French, German, Italian and Portuguese', () => {
    expect(ygoprodeck.nameLanguages).toEqual(['French', 'German', 'Italian', 'Portuguese']);
  });

  it('refuses a language it has no names in', async () => {
    await expect(ygoprodeck.fetchNames('Spanish')).rejects.toThrow('No Spanish card names');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/sources/ygoprodeck.test.ts`
Expected: FAIL (`names` is not exported; printings lack `cardId`).

- [ ] **Step 3: Implement**

`src/sources/types.ts`:

```ts
import type { Language } from '../setCode';

export type Printing = {
  code: string; // as indexed by the source, e.g. "LOB-EN001"
  cardId: number; // the same for every printing of a card; 0 in data saved before names existed
  name: string;
  setName: string;
  rarity: string;
};

export type CardName = [cardId: number, name: string];

export type Source = {
  id: string;
  name: string; // shown in Settings
  fetchVersion(): Promise<string>;
  fetchPrintings(): Promise<Printing[]>;
  nameLanguages: Language[]; // languages other than English it has card names in
  fetchNames(language: Language): Promise<CardName[]>;
};
```

`src/sources/ygoprodeck.ts`: import `type { Language } from '../setCode'` and `CardName` from `./types`; change `RawCard` to `{ id?: unknown; name?: unknown; card_sets?: unknown }`; in `flatten` replace the guard line and add the id:

```ts
    if (typeof card?.id !== 'number' || typeof card.name !== 'string' || !Array.isArray(card.card_sets)) continue;
```
```ts
      const printing: Printing = {
        code: set.set_code,
        cardId: card.id,
        name: card.name,
```

Add after `flatten`:

```ts
// Keeps only what is needed of a card list in another language.
export function names(json: unknown): CardName[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error('Unexpected card data format');
  const found: CardName[] = [];
  for (const card of data as (RawCard | null)[]) {
    if (typeof card?.id === 'number' && typeof card.name === 'string' && card.name !== '') found.push([card.id, card.name]);
  }
  return found;
}

const NAME_LANGUAGE: Partial<Record<Language, string>> = { French: 'fr', German: 'de', Italian: 'it', Portuguese: 'pt' };
```

and in the `ygoprodeck` object:

```ts
  nameLanguages: ['French', 'German', 'Italian', 'Portuguese'],

  async fetchNames(language) {
    const parameter = NAME_LANGUAGE[language];
    if (!parameter) throw new Error(`No ${language} card names in this database`);
    return names(await getJson(`cardinfo.php?language=${parameter}`, 'Card names download', CARDS_TIMEOUT_MS));
  },
```

- [ ] **Step 4: Fix the fixtures the new type breaks**

Run: `npx tsc --noEmit`
For every error "Property 'cardId' is missing" in a test file, add a `cardId` to that fixture: `1` where the file has a single card, distinct numbers where it has several cards (in `src/cardDatabase.test.ts`: `BEWD` 1, `DM` 2, `ULTRA` and `SECRET` 3). For every error on a fake `Source` (in `src/cardDatabase.test.ts` `fakeSource`), add:

```ts
    nameLanguages: [],
    async fetchNames() {
      return [];
    },
```

Do not change product code in this step. `src/replay.ts` needs no change.

- [ ] **Step 5: Run everything**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "Get card ids and translated card names from the source"
```

---

### Task 3: Name index

**Files:**
- Create: `src/nameIndex.ts`
- Test: `src/nameIndex.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type NameEntry = { cardId: number; name: string; language: Language };
  type NameMatch = NameEntry & { score: number };
  type NameIndex = { find(text: string): NameMatch | null };
  function normalise(text: string): string;
  function buildNameIndex(entries: NameEntry[]): NameIndex;
  ```

- [ ] **Step 1: Write the failing tests**

`src/nameIndex.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/nameIndex.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/nameIndex.ts`:

```ts
import type { Language } from './setCode';

export type NameEntry = { cardId: number; name: string; language: Language };
export type NameMatch = NameEntry & { score: number };
export type NameIndex = { find(text: string): NameMatch | null };

const MIN_SCORE = 0.8; // how alike the reading and the name must be, from 0 to 1
const MIN_LEAD = 0.1; // how far ahead of the best other card the winner must be
const MIN_LENGTH = 4; // shorter texts are alike too easily
const SHORTLIST = 20; // names compared letter by letter with the reading

// The text reader lacks several accented letters and reads names in small
// capitals, so names are compared on plain lower-case letters and digits only.
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function sequences(text: string): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i + 3 <= text.length; i++) found.add(text.slice(i, i + 3));
  return found;
}

// The number of single-character changes that turn one text into the other.
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

// Files every name under its three-letter sequences, so that a reading is only
// compared letter by letter with the few names that share the most of them.
export function buildNameIndex(entries: NameEntry[]): NameIndex {
  const keys: string[] = []; // each distinct normalised name
  const entriesOf: NameEntry[][] = []; // the cards and languages it stands for
  const position = new Map<string, number>();
  const bySequence = new Map<string, number[]>();

  for (const entry of entries) {
    const key = normalise(entry.name);
    if (key.length < MIN_LENGTH) continue;
    let at = position.get(key);
    if (at === undefined) {
      at = keys.length;
      position.set(key, at);
      keys.push(key);
      entriesOf.push([]);
      for (const sequence of sequences(key)) {
        const list = bySequence.get(sequence);
        if (list) list.push(at);
        else bySequence.set(sequence, [at]);
      }
    }
    entriesOf[at].push(entry);
  }

  const shared = new Uint16Array(keys.length); // sequences in common with the reading; all zero between lookups

  return {
    find(text) {
      const read = normalise(text);
      if (read.length < MIN_LENGTH) return null;

      const touched: number[] = [];
      for (const sequence of sequences(read)) {
        for (const at of bySequence.get(sequence) ?? []) {
          if (shared[at]++ === 0) touched.push(at);
        }
      }
      // Among names sharing as much, the one closest in length is the likeliest.
      touched.sort(
        (a, b) => shared[b] - shared[a] || Math.abs(keys[a].length - read.length) - Math.abs(keys[b].length - read.length),
      );
      const shortlist = touched.slice(0, SHORTLIST);
      for (const at of touched) shared[at] = 0;

      const scored: NameMatch[] = [];
      for (const at of shortlist) {
        const score = 1 - distance(read, keys[at]) / Math.max(read.length, keys[at].length);
        for (const entry of entriesOf[at]) scored.push({ ...entry, score });
      }
      scored.sort((a, b) => b.score - a.score);

      const best = scored[0];
      if (!best || best.score < MIN_SCORE) return null;
      const rival = scored.find((other) => other.cardId !== best.cardId);
      if (rival && best.score - rival.score < MIN_LEAD) return null;
      return best;
    },
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/nameIndex.test.ts`
Expected: PASS. If `finds a name read without accents…` fails on the score bounds, do not loosen `MIN_SCORE`; check the normalised strings first (`renfortdelarmfe` against `renfortdelarmee` is one change in fifteen).

- [ ] **Step 5: Commit**

```bash
git add src/nameIndex.ts src/nameIndex.test.ts
git commit -m "Add an index that finds the card a read name belongs to"
```

---

### Task 4: Names in the card database

**Files:**
- Modify: `src/cardDatabase.ts`
- Test: `src/cardDatabase.test.ts`

**Interfaces:**
- Consumes: `Printing.cardId`, `CardName`, `Source.nameLanguages`, `Source.fetchNames` (Task 2); `buildNameIndex`, `NameIndex`, `NameMatch`, `NameEntry` (Task 3).
- Produces, on the object returned by `createCardDatabase`:
  ```ts
  findByName(text: string): NameMatch | null;
  printingsOf(cardId: number): Printing[];
  ```

- [ ] **Step 1: Extend the fake source in the test file**

In `src/cardDatabase.test.ts`, replace the `nameLanguages`/`fetchNames` stubs added in Task 2 so the fake can serve names (keep the default of no languages, so the existing tests are untouched):

```ts
import type { Language } from './setCode';
import type { CardName, Printing, Source } from './sources/types';
```

In `fakeSource`, add to `state`:

```ts
    languages: [] as Language[],
    names: {} as Partial<Record<Language, CardName[]>>,
    failNames: new Set<Language>(),
    namesCalls: [] as Language[],
```

and to `source`:

```ts
    get nameLanguages() {
      return state.languages;
    },
    async fetchNames(language) {
      state.namesCalls.push(language);
      if (state.failNames.has(language)) throw new Error('offline');
      return state.names[language] ?? [];
    },
```

- [ ] **Step 2: Write the failing tests**

Append to `src/cardDatabase.test.ts`:

```ts
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
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/cardDatabase.test.ts`
Expected: the new tests FAIL (`findByName is not a function`); the existing ones PASS.

- [ ] **Step 4: Implement**

In `src/cardDatabase.ts`:

Imports and constants:

```ts
import { buildNameIndex, type NameEntry, type NameIndex, type NameMatch } from './nameIndex';
import type { Language } from './setCode';
import type { CardName, Printing, Source } from './sources/types';

const NAMES = 'names';

type StoredNames = Partial<Record<Language, CardName[]>>;
```

`openDatabase` moves to version 2 and creates only what is missing:

```ts
    const request = idb.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SUBSCRIPTIONS)) db.createObjectStore(SUBSCRIPTIONS, { keyPath: 'sourceId' });
      // One record per source: key = sourceId, value = Printing[].
      if (!db.objectStoreNames.contains(PRINTINGS)) db.createObjectStore(PRINTINGS);
      // One record per source: key = sourceId, value = names per language.
      if (!db.objectStoreNames.contains(NAMES)) db.createObjectStore(NAMES);
    };
```

New state next to `byCode`:

```ts
  const namesBySource = new Map<string, StoredNames>();
  let byCard = new Map<number, Printing[]>();
  let nameIndex: NameIndex = buildNameIndex([]);
```

`rebuildIndex` becomes:

```ts
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
```

Add after `store`:

```ts
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
```

In `download`, replace the last three lines (`subscriptionsById.set` … `return added;`) with:

```ts
    subscriptionsById.set(sourceId, subscription);
    printingsBySource.set(sourceId, printings);
    rebuildIndex();
    notify(); // cards can be scanned by code while the names are still coming

    setActivity(sourceId, 'downloading');
    await downloadNames(sourceId, source.nameLanguages);
    return added;
```

In `load`, read the names in the same transaction and give old printings a card id of 0:

```ts
        const transaction = db.transaction([SUBSCRIPTIONS, PRINTINGS, NAMES], 'readonly');
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
```

Keep the comment about issuing all requests before the first await.

In `unsubscribe`: transaction over `[SUBSCRIPTIONS, PRINTINGS, NAMES]`, add `transaction.objectStore(NAMES).delete(sourceId);` and `namesBySource.delete(sourceId);`.

In `checkForUpdates`, replace the `if (version === subscription.version) { … } else { … }` block with:

```ts
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
```

Add to the returned object, after `suggest`:

```ts
    // The card a name read by the camera most probably belongs to, in any language held.
    findByName(text: string): NameMatch | null {
      return nameIndex.find(text);
    },

    printingsOf(cardId: number): Printing[] {
      return byCard.get(cardId) ?? [];
    },
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/cardDatabase.test.ts`
Expected: PASS, including every test that existed before. If an older test that counts `added` or phases fails, the cause is in `download`: `onProgress` must still be called only with `'downloading'` then `'saving'`.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm test
git add src/cardDatabase.ts src/cardDatabase.test.ts
git commit -m "Store card names per language and find cards by name"
```

---

### Task 5: Read the name line

**Files:**
- Modify: `src/ocr/decode.ts`, `src/ocr/textBoxes.ts`, `src/ocr/ocr.ts`, `src/ui/ScanScreen.tsx`, `src/replay.ts`
- Test: `src/ocr/textBoxes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/ocr/decode.ts
  type Reading = { codes: Line[]; names: Line[] };
  // src/ocr/textBoxes.ts
  function nameBoxes(boxes: Box[], width: number, height: number): Box[];
  // src/ocr/ocr.ts
  function recognise(whole: HTMLCanvasElement): Promise<Reading>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/ocr/textBoxes.test.ts` (add `nameBoxes` and `type Box` to the import):

```ts
describe('nameBoxes', () => {
  // A picture 1000 wide and 1000 high.
  const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
  const name = box(100, 90, 700, 140);
  const type = box(450, 170, 850, 200);
  const code = box(700, 650, 880, 680);
  const effect = box(100, 720, 900, 760);
  const speck = box(100, 20, 180, 40);

  it('keeps wide lines near the top, widest first', () => {
    expect(nameBoxes([code, type, effect, name, speck], 1000, 1000)).toEqual([name, type]);
  });

  it('keeps at most two', () => {
    const third = box(100, 50, 600, 80);
    expect(nameBoxes([name, type, third], 1000, 1000)).toEqual([name, third]);
  });

  it('judges position by the middle of the line', () => {
    expect(nameBoxes([box(100, 200, 700, 239)], 1000, 1000)).toHaveLength(1);
    expect(nameBoxes([box(100, 201, 700, 241)], 1000, 1000)).toHaveLength(0);
  });

  it('finds none when nothing is there', () => {
    expect(nameBoxes([], 1000, 1000)).toEqual([]);
    expect(nameBoxes([code, effect], 1000, 1000)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ocr/textBoxes.test.ts`
Expected: FAIL (`nameBoxes` is not exported).

- [ ] **Step 3: Implement `nameBoxes`**

Append to `src/ocr/textBoxes.ts`:

```ts
const NAME_ZONE = 0.22; // the card name lies in this top part of the picture
const NAME_MIN_WIDTH = 0.35; // and spans at least this much of its width
const MAX_NAME_LINES = 2;

// The boxes that may hold the card name when the card is roughly inside the
// outline: wide lines near the top, widest first.
export function nameBoxes(boxes: Box[], width: number, height: number): Box[] {
  const span = (box: Box) => box.right - box.left + 1;
  return boxes
    .filter((box) => (box.top + box.bottom) / 2 < height * NAME_ZONE && span(box) >= width * NAME_MIN_WIDTH)
    .sort((a, b) => span(b) - span(a))
    .slice(0, MAX_NAME_LINES);
}
```

Run: `npx vitest run src/ocr/textBoxes.test.ts` — Expected: PASS.

- [ ] **Step 4: Read the name lines**

`src/ocr/decode.ts`, after the `Line` type:

```ts
// What one look at the picture gave: lines shaped like a set code, and lines that may be the card name.
export type Reading = { codes: Line[]; names: Line[] };
```

`src/ocr/ocr.ts`:

- Imports: `import { decode, type Line, type Reading } from './decode';` and `import { findTextBoxes, nameBoxes, type Box } from './textBoxes';`
- Add `const MAX_NAME_WIDTH = 640; // card names are long` under `MAX_LINE_WIDTH`.
- `recognise` returns `Promise<Reading>`. Its comment becomes:

```ts
// Finds the lines of text in the picture and reads those shaped like a set code.
// Readings alternate between the whole picture and a close-up of part of it;
// on the whole picture, the lines where the card name is are read as well.
```

- First lines of the body:

```ts
  if (whole.width === 0 || whole.height === 0) return { codes: [], names: [] };
  const reader = await getReader();
  const closeUp = closeUpNext;
  const source = closeUp ? cut(whole, CLOSE_UP) : whole;
  closeUpNext = !closeUpNext;
```

- Replace the block from `const shape = …` to the end of the function with:

```ts
  const all = findTextBoxes(probability, width, height);
  const titles = closeUp ? [] : nameBoxes(all, width, height);

  const shape = (box: Box) => (box.right - box.left + 1) / (box.bottom - box.top + 1);
  const boxes = all
    .filter((box) => !titles.includes(box) && shape(box) >= 2.5 && shape(box) <= 11)
    .sort((a, b) => Math.abs(shape(a) - CODE_SHAPE) - Math.abs(shape(b) - CODE_SHAPE))
    .slice(0, MAX_LINES);

  const scaleX = source.width / width;
  const scaleY = source.height / height;
  const fullSize = (box: Box): Box => ({
    left: box.left * scaleX,
    top: box.top * scaleY,
    right: (box.right + 1) * scaleX,
    bottom: (box.bottom + 1) * scaleY,
  });
  const codes: Line[] = [];
  for (const box of boxes) codes.push(await readLine(reader, source, fullSize(box), MAX_LINE_WIDTH));
  const names: Line[] = [];
  for (const box of titles) names.push(await readLine(reader, source, fullSize(box), MAX_NAME_WIDTH));

  context.lineWidth = 2;
  context.strokeStyle = '#ff2d55';
  for (const box of boxes) context.strokeRect(box.left, box.top, box.right - box.left + 1, box.bottom - box.top + 1);
  context.strokeStyle = '#34c759';
  for (const box of titles) context.strokeRect(box.left, box.top, box.right - box.left + 1, box.bottom - box.top + 1);
  lastPicture = small;

  return { codes: codes.filter((line) => line.text !== ''), names: names.filter((line) => line.text !== '') };
```

- `readLine` takes the limit: signature `readLine(reader: Reader, source: HTMLCanvasElement, box: Box, maxWidth: number)`, and `Math.min(MAX_LINE_WIDTH, …)` becomes `Math.min(maxWidth, …)`.

- [ ] **Step 5: Update the two callers (detector unchanged for now)**

`src/ui/ScanScreen.tsx`, in `handleFrame`:

```ts
    const read = await recognise(canvas);
    if (showDetails) {
      const show = (lines: typeof read.codes) => lines.map((line) => `${line.text} (${Math.round(line.confidence * 100)}%)`).join(' · ');
      setDetails({
        text: [read.names.length > 0 ? `Name: ${show(read.names)}` : '', show(read.codes)].filter(Boolean).join(' — '),
        picture: pictureLastRead()?.toDataURL('image/jpeg', 0.7) ?? null,
        milliseconds: Math.round(performance.now() - started),
      });
    }
    const detection = detector.feed(read.codes);
```

`src/replay.ts`, in the loop:

```ts
    const read = await recognise(canvas);
    const milliseconds = Math.round(performance.now() - started);
    const show = (lines: typeof read.codes) => lines.map((line) => `${line.text} (${Math.round(line.confidence * 100)}%)`);
    readings.push({ milliseconds, codes: show(read.codes), names: show(read.names) });
    detected ??= detector.feed(read.codes)?.code ?? null;
```

- [ ] **Step 6: Verify on the real pictures**

Run: `npx tsc --noEmit && npm test && npm run replay`
Expected: tests pass. In the replay output, readings 1 and 3 of each picture have a `names` list and readings 2 and 4 have none. For `IMG_9750.jpg` the names should contain something close to `RENFORT DE L'ARMEE`.

If names are empty or wrong for most pictures, look at the cause before changing anything: check the card rectangles in `scripts/replay-pictures.json` first (the name must fall in the top 22 % of the crop). Only if the rectangles are right, adjust `NAME_ZONE` or `NAME_MIN_WIDTH`, update the `nameBoxes` tests and the spec to the new values, and say so in the commit message.

Compare the average with the Task 1 baseline. Add to the plan's Baseline section: `After name reading (Task 5): average M ms per reading (+P %).` If P is above 15, set `MAX_NAME_LINES` to 1, update its test (`keeps at most two` becomes `keeps only the widest`), and measure again.

- [ ] **Step 7: Commit**

```bash
git add -A src docs/superpowers
git commit -m "Read the card name line on whole-picture readings"
```

---

### Task 6: Result panel that opens on a card

**Files:**
- Modify: `src/setCode.ts`, `src/ui/ResultPanel.tsx`
- Test: `src/setCode.test.ts`

**Interfaces:**
- Consumes: `db.printingsOf(cardId)` (Task 4).
- Produces:
  ```ts
  // src/setCode.ts
  function printedCode(code: string, language: Language): string;
  // src/ui/ResultPanel.tsx — new optional prop
  initialCard?: { cardId: number; name: string; language: Language } | null;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/setCode.test.ts` (add `printedCode` to the import):

```ts
describe('printedCode', () => {
  it('puts the language marker into a modern code', () => {
    expect(printedCode('RA01-EN051', 'French')).toBe('RA01-FR051');
    expect(printedCode('RA01-EN051', 'German')).toBe('RA01-DE051');
    expect(printedCode('RA01-EN051', 'Italian')).toBe('RA01-IT051');
    expect(printedCode('RA01-EN051', 'Portuguese')).toBe('RA01-PT051');
  });

  it('puts the one-letter marker into an old code', () => {
    expect(printedCode('LOB-E001', 'French')).toBe('LOB-F001');
    expect(printedCode('LOB-E001', 'German')).toBe('LOB-G001');
  });

  it('leaves the code alone for English, for codes without a marker, and for other languages', () => {
    expect(printedCode('RA01-EN051', 'English')).toBe('RA01-EN051');
    expect(printedCode('SDK-001', 'French')).toBe('SDK-001');
    expect(printedCode('RA01-EN051', 'Japanese')).toBe('RA01-EN051');
    expect(printedCode('RA01-EN051', 'Unknown')).toBe('RA01-EN051');
  });

  it('gives codes that read back as that language', () => {
    expect(languageOf(parse(printedCode('RA01-EN051', 'French')).region)).toBe('French');
    expect(languageOf(parse(printedCode('LOB-E001', 'Italian')).region)).toBe('Italian');
  });
});
```

(`languageOf` and `parse` are already exported; add them to the test's import if missing.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/setCode.test.ts`
Expected: FAIL (`printedCode` is not exported).

- [ ] **Step 3: Implement `printedCode`**

In `src/setCode.ts`, after `languageOf`:

```ts
const MODERN_MARKER: Partial<Record<Language, string>> = { French: 'FR', German: 'DE', Italian: 'IT', Spanish: 'SP', Portuguese: 'PT' };
const OLD_MARKER: Partial<Record<Language, string>> = { French: 'F', German: 'G', Italian: 'I', Spanish: 'S', Portuguese: 'P' };

// The code as it is printed on a card in the given language, from the database's
// (English) form. Left as it is when the code carries no language marker.
export function printedCode(code: string, language: Language): string {
  const { prefix, region, number } = parse(code);
  const marker = region === 'EN' ? MODERN_MARKER[language] : region === 'E' ? OLD_MARKER[language] : undefined;
  return marker ? `${prefix}-${marker}${number}` : code;
}
```

Run: `npx vitest run src/setCode.test.ts` — Expected: PASS.

- [ ] **Step 4: Let the panel open on a card**

`src/ui/ResultPanel.tsx`:

- Import `printedCode` from `'../setCode'`.
- Props:

```ts
type Props = {
  db: CardDatabase;
  initialCode: string;
  // A card recognised by its name, whose code could not be read.
  initialCard?: { cardId: number; name: string; language: Language } | null;
  hint: string | null;
  onAdd: (entry: NewEntry) => void;
  onClose: (() => void) | null;
};

export function ResultPanel({ db, initialCode, initialCard = null, hint, onAdd, onClose }: Props) {
```

- After the `rarities` line:

```ts
  // While no code is entered, a card known by name offers the sets it was printed in.
  const choices = initialCard && !code ? [...new Map(db.printingsOf(initialCard.cardId).map((p) => [p.code, p])).values()] : [];
```

- The language effect: a code without a language marker says nothing about the language, so the language the name was read in is used:

```ts
  useEffect(() => {
    const fromCode = code ? languageOf(parse(code).region) : 'Unknown';
    setLanguage(code && initialCard && parse(code).region === '' ? initialCard.language : fromCode);
    setRarity(rarities.length === 1 ? rarities[0] : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, found?.matchedCode]);
```

- In the JSX, right after the "Set code" `<label>`:

```tsx
      {initialCard && !code && (
        <div className="stack">
          <div>
            <strong>{initialCard.name}</strong>
            <div className="muted">Recognised by its name. Choose the set, or type the code printed on the card.</div>
          </div>
          <label className="stack">
            <span className="muted">Printing</span>
            <select value="" onChange={(event) => setText(printedCode(event.target.value, initialCard.language))}>
              <option value="">Choose a set</option>
              {choices.map((printing) => (
                <option key={printing.code} value={printing.code}>
                  {printing.code} — {printing.setName}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS. (The panel has no automated test in this project; it is exercised in Task 8.)

```bash
git add src/setCode.ts src/setCode.test.ts src/ui/ResultPanel.tsx
git commit -m "Let the result panel open on a card recognised by name"
```

---

### Task 7: Detector that combines code and name

**Files:**
- Modify: `src/detector.ts`
- Test: `src/detector.test.ts`
- Modify (to keep the build green; full wiring is Task 8): `src/ui/ScanScreen.tsx`, `src/replay.ts`

**Interfaces:**
- Consumes: `Reading` (Task 5), `NameMatch` (Task 3), `Printing.cardId` (Task 2), `withinOne` from `src/cardDatabase.ts`, `parse` and `candidateCodes` from `src/setCode.ts`.
- Produces:
  ```ts
  type Cards = {
    find(code: string): Match | null;            // as before: match(db, code)
    findByName(text: string): NameMatch | null;
    printingsOf(cardId: number): Printing[];
  };
  type Detection =
    | { kind: 'code'; code: string; match: Match }
    | { kind: 'card'; cardId: number; name: string; language: Language };
  type Detector = { feed(reading: Reading): Detection | null; dismiss(detection: Detection): void };
  function createDetector(cards: Cards): Detector;
  ```

The spec lists `suggest` among the detector's inputs; it is not needed. A near-miss is found from the named card's own printings, which is exact where `suggest` stops at five results.

- [ ] **Step 1: Adapt the existing tests to the new interface**

In `src/detector.test.ts`, replace the header (everything above `describe('createDetector'`) with:

```ts
import { describe, expect, it } from 'vitest';
import type { Match } from './cardMatch';
import { createDetector, type Cards, type Detection } from './detector';
import type { NameMatch } from './nameIndex';
import type { Line } from './ocr/decode';
import type { Printing } from './sources/types';

// Card 1 is printed as LOB-EN001 and SDK-001, card 2 as LOB-EN002, card 3 as DUEA-ENSE1.
const PRINTINGS: Printing[] = [
  { code: 'LOB-EN001', cardId: 1, name: 'Blue-Eyes White Dragon', setName: 'LOB', rarity: 'Ultra Rare' },
  { code: 'SDK-001', cardId: 1, name: 'Blue-Eyes White Dragon', setName: 'SDK', rarity: 'Ultra Rare' },
  { code: 'LOB-EN002', cardId: 2, name: 'Hitotsu-Me Giant', setName: 'LOB', rarity: 'Common' },
  { code: 'DUEA-ENSE1', cardId: 3, name: 'Special', setName: 'DUEA', rarity: 'Super Rare' },
];
const NAMES: Record<string, NameMatch> = {
  'DRAGON BLANC AUX YEUX BLEUS': { cardId: 1, name: 'Dragon Blanc aux Yeux Bleus', language: 'French', score: 1 },
  'HITOTSU-ME GIANT': { cardId: 2, name: 'Hitotsu-Me Giant', language: 'English', score: 1 },
};

function cards(printings: Printing[] = PRINTINGS): Cards {
  return {
    // French codes resolve to the English entry, as match() does.
    find(code): Match | null {
      const matchedCode = code.replace('-FR', '-EN');
      const found = printings.filter((p) => p.code === matchedCode);
      return found.length > 0 ? { matchedCode, printings: found } : null;
    },
    findByName: (text) => NAMES[text] ?? null,
    printingsOf: (cardId) => printings.filter((p) => p.cardId === cardId),
  };
}

// Lines read with too little confidence to be trusted on a single reading.
const unsure = (text: string): Line[] => text.split('\n').map((line) => ({ text: line, confidence: 0.5 }));
const sure = (text: string): Line[] => [{ text, confidence: 0.95 }];
const read = (codes: Line[], name = '') => ({ codes, names: name ? [{ text: name, confidence: 0.6 }] : [] });
const nothing = read([]);

const codeOf = (detection: Detection | null) => (detection?.kind === 'code' ? detection.code : null);
const cardOf = (detection: Detection | null) => (detection?.kind === 'card' ? detection.cardId : null);
const BLUE_EYES = 'DRAGON BLANC AUX YEUX BLEUS';
```

Then convert each existing test mechanically, keeping its name and intent:

- `createDetector(find)` → `createDetector(cards())`
- `detector.feed(X)` → `detector.feed(read(X))`
- `detector.feed(...)?.code` → `codeOf(detector.feed(read(...)))`
- `detector.dismiss('CODE')` → `detector.dismiss({ kind: 'code', code: 'CODE', match: cards().find('CODE')! })`
- A test that used the code `SDK-001`, `LOB-FR001` or `DUEA-ENSE1` keeps working: all are in `PRINTINGS`.

Run: `npx vitest run src/detector.test.ts` — Expected: FAIL to compile/run (`Cards` not exported). That is the failing state for this step.

- [ ] **Step 2: Add the failing tests for the new behaviour**

Append inside the `describe('createDetector', …)` block:

```ts
  describe('with the card name', () => {
    it('accepts an unsure code at once when the name read is that card', () => {
      const detector = createDetector(cards());
      expect(codeOf(detector.feed(read(unsure('LOB-FR001'), BLUE_EYES)))).toBe('LOB-FR001');
    });

    it('remembers the name for the next reading', () => {
      const detector = createDetector(cards());
      expect(detector.feed(read([], BLUE_EYES))).toBeNull();
      expect(codeOf(detector.feed(read(unsure('LOB-FR001'))))).toBe('LOB-FR001');
    });

    it('forgets the name after three readings', () => {
      const detector = createDetector(cards());
      detector.feed(read([], BLUE_EYES));
      detector.feed(nothing);
      detector.feed(nothing);
      expect(detector.feed(read(unsure('LOB-FR001')))).toBeNull();
    });

    it('corrects a code one character off to the named card', () => {
      const detector = createDetector(cards());
      // LOB-FR007 does not exist; the named card is LOB-..001.
      expect(codeOf(detector.feed(read(unsure('LOB-FR007'), BLUE_EYES)))).toBe('LOB-FR001');
    });

    it('corrects an existing code to the named card when they are one character apart', () => {
      const detector = createDetector(cards());
      // LOB-FR002 is card 2, but the name says card 1, printed as LOB-..001.
      const detection = detector.feed(read(sure('LOB-FR002'), BLUE_EYES));
      expect(codeOf(detection)).toBe('LOB-FR001');
      expect(detection?.kind === 'code' && detection.match.printings[0].cardId).toBe(1);
    });

    it('keeps the language marker that was read when correcting', () => {
      const detector = createDetector(cards());
      expect(codeOf(detector.feed(read(unsure('LOB-EN007'), BLUE_EYES)))).toBe('LOB-EN001');
    });

    it('does not correct a code two characters off', () => {
      const detector = createDetector(cards());
      expect(detector.feed(read(unsure('LOB-FR077'), BLUE_EYES))).toBeNull();
    });

    it('does not trust a sure code on one reading when the name says another, unrelated card', () => {
      const detector = createDetector(cards());
      // DUEA-ENSE1 is card 3; the name says card 1, which has no code near it.
      expect(detector.feed(read(sure('DUEA-ENSE1'), BLUE_EYES))).toBeNull();
      expect(codeOf(detector.feed(read(sure('DUEA-ENSE1'))))).toBe('DUEA-ENSE1');
    });

    it('ignores a name that matches nothing', () => {
      const detector = createDetector(cards());
      expect(detector.feed(read([], '[CARTE MAGIE]'))).toBeNull();
      expect(detector.feed(read([], '[CARTE MAGIE]'))).toBeNull();
      expect(codeOf(detector.feed(read(sure('LOB-EN001'), '[CARTE MAGIE]')))).toBe('LOB-EN001');
    });

    it('reports the card when its name is read twice and no code is', () => {
      const detector = createDetector(cards());
      expect(detector.feed(read([], BLUE_EYES))).toBeNull();
      expect(detector.feed(nothing)).toBeNull();
      const detection = detector.feed(read([], BLUE_EYES));
      expect(detection).toEqual({ kind: 'card', cardId: 1, name: 'Dragon Blanc aux Yeux Bleus', language: 'French' });
    });

    it('does not report a card for one name reading, nor for two different names', () => {
      const detector = createDetector(cards());
      expect(detector.feed(read([], BLUE_EYES))).toBeNull();
      expect(detector.feed(read([], 'HITOTSU-ME GIANT'))).toBeNull();
    });

    it('does not report a card by name while a code is being read', () => {
      const detector = createDetector(cards());
      detector.feed(read([], BLUE_EYES));
      expect(cardOf(detector.feed(read(unsure('DUEA-ENSE1'), BLUE_EYES)))).toBeNull();
    });

    it('does not reopen a dismissed card by its name', () => {
      const detector = createDetector(cards());
      const detection = detector.feed(read(sure('LOB-EN001')))!;
      detector.dismiss(detection);
      for (let i = 0; i < 6; i++) expect(detector.feed(read(i % 2 ? [] : sure('LOB-EN001'), i % 2 ? '' : BLUE_EYES))).toBeNull();
    });

    it('does not reopen a card dismissed by name through its code', () => {
      const detector = createDetector(cards());
      detector.feed(read([], BLUE_EYES));
      detector.feed(nothing);
      detector.dismiss(detector.feed(read([], BLUE_EYES))!);
      expect(detector.feed(read(sure('SDK-001'), BLUE_EYES))).toBeNull();
    });

    it('releases a card dismissed by name once it has left the view', () => {
      const detector = createDetector(cards());
      detector.dismiss({ kind: 'card', cardId: 1, name: 'x', language: 'French' });
      detector.feed(nothing);
      detector.feed(nothing);
      detector.feed(nothing);
      expect(codeOf(detector.feed(read(sure('LOB-EN001'))))).toBe('LOB-EN001');
    });
  });

  describe('old data without card ids', () => {
    const old = PRINTINGS.map((p) => ({ ...p, cardId: 0 }));

    it('still reports codes', () => {
      const detector = createDetector(cards(old));
      expect(codeOf(detector.feed(read(sure('LOB-EN001'))))).toBe('LOB-EN001');
    });

    it('dismissing one code does not block the others', () => {
      const detector = createDetector(cards(old));
      detector.dismiss(detector.feed(read(sure('LOB-EN001')))!);
      expect(codeOf(detector.feed(read(sure('DUEA-ENSE1'))))).toBe('DUEA-ENSE1');
    });
  });
```

- [ ] **Step 3: Implement**

Replace `src/detector.ts` with:

```ts
import { withinOne } from './cardDatabase';
import type { Match } from './cardMatch';
import type { NameMatch } from './nameIndex';
import type { Reading } from './ocr/decode';
import { candidateCodes, parse, type Language } from './setCode';
import type { Printing } from './sources/types';

export type Cards = {
  find(code: string): Match | null;
  findByName(text: string): NameMatch | null;
  printingsOf(cardId: number): Printing[];
};

// A card found by its code, or by its name alone when no code could be read.
export type Detection =
  | { kind: 'code'; code: string; match: Match }
  | { kind: 'card'; cardId: number; name: string; language: Language };

export type Detector = {
  // Takes what one camera reading gave; returns a card once it is certain enough.
  feed(reading: Reading): Detection | null;
  // Stops reporting this card until it has left the view.
  dismiss(detection: Detection): void;
};

const SURE = 0.8; // a line read with at least this confidence is trusted on its own
const WINDOW = 3; // otherwise a code or a name is trusted once read twice within this many readings; a name is also remembered this long
const RELEASE = 3; // readings in a row without a dismissed card before it counts again

export function createDetector(cards: Cards): Detector {
  const lastSeen = new Map<string, number>(); // code -> number of the reading it was last in
  const dismissedCodes = new Map<string, number>(); // code -> readings in a row without it
  const dismissedCards = new Map<number, number>(); // card id -> readings in a row without it
  // The name comes from whole-picture readings and the code often from
  // close-ups, so the last name is kept for the readings that follow.
  let named: { match: NameMatch; at: number; before: number | null } | null = null;
  let reading = 0;

  const isCard = (match: Match, cardId: number) => match.printings.some((printing) => printing.cardId === cardId);

  // The code the named card is printed under that is one character away from
  // the code read, written with the language marker that was read.
  function nearCode(candidate: string, cardId: number): Detection | null {
    const read = parse(candidate);
    for (const printing of cards.printingsOf(cardId)) {
      const known = parse(printing.code);
      if (!withinOne(`${read.prefix}-${read.number}`, `${known.prefix}-${known.number}`)) continue;
      const code = `${known.prefix}-${read.region}${known.number}`;
      const match = cards.find(code);
      if (match && isCard(match, cardId)) return { kind: 'code', code, match };
    }
    return null;
  }

  function blocked(detection: Detection): boolean {
    if (detection.kind === 'card') return dismissedCards.has(detection.cardId);
    return dismissedCodes.has(detection.code) || detection.match.printings.some((printing) => dismissedCards.has(printing.cardId));
  }

  function age<Key>(dismissed: Map<Key, number>, inView: (key: Key) => boolean): void {
    for (const [key, misses] of dismissed) {
      if (inView(key)) dismissed.set(key, 0);
      else if (misses + 1 >= RELEASE) dismissed.delete(key);
      else dismissed.set(key, misses + 1);
    }
  }

  function accept(detection: Detection): Detection {
    lastSeen.clear();
    named = null;
    return detection;
  }

  return {
    feed({ codes, names }) {
      reading++;

      for (const line of names) {
        const match = cards.findByName(line.text);
        if (!match) continue;
        named = { match, at: reading, before: named && named.match.cardId === match.cardId ? named.at : null };
        break;
      }
      if (named && reading - named.at >= WINDOW) named = null;
      const name = named?.match ?? null;

      const seen = new Map<string, { match: Match; sure: boolean }>();
      let agreed: Detection | null = null; // a code that exists and belongs to the named card
      let corrected: Detection | null = null; // the named card's code, one character from what was read
      for (const line of codes) {
        const candidates = candidateCodes(line.text);
        for (const code of candidates) {
          const match = cards.find(code);
          if (!match) continue;
          seen.set(code, { match, sure: line.confidence >= SURE || seen.get(code)?.sure === true });
          if (name && isCard(match, name.cardId)) agreed ??= { kind: 'code', code, match };
          break;
        }
        if (name && !agreed && !corrected) {
          for (const candidate of candidates) {
            corrected = nearCode(candidate, name.cardId);
            if (corrected) break;
          }
        }
      }

      const cardsInView = new Set<number>();
      if (named?.at === reading) cardsInView.add(named.match.cardId);
      for (const { match } of seen.values()) for (const printing of match.printings) cardsInView.add(printing.cardId);
      age(dismissedCodes, (code) => seen.has(code));
      age(dismissedCards, (cardId) => cardsInView.has(cardId));

      if (agreed) return blocked(agreed) ? null : accept(agreed);
      if (corrected && !blocked(corrected)) return accept(corrected);

      for (const [code, { match, sure }] of seen) {
        const detection: Detection = { kind: 'code', code, match };
        if (blocked(detection)) continue;
        const previous = lastSeen.get(code);
        // A name that says another card takes away the benefit of the doubt.
        if ((sure && !name) || (previous !== undefined && reading - previous < WINDOW)) return accept(detection);
        lastSeen.set(code, reading);
      }

      if (seen.size === 0 && named && named.at === reading && named.before !== null && reading - named.before < WINDOW) {
        const { cardId, name: cardName, language } = named.match;
        const detection: Detection = { kind: 'card', cardId, name: cardName, language };
        if (!blocked(detection)) return accept(detection);
      }
      return null;
    },

    dismiss(detection) {
      if (detection.kind === 'card') {
        dismissedCards.set(detection.cardId, 0);
        return;
      }
      dismissedCodes.set(detection.code, 0);
      lastSeen.delete(detection.code);
      // 0 marks data saved before names existed: no card to tell apart.
      for (const printing of detection.match.printings) {
        if (printing.cardId) dismissedCards.set(printing.cardId, 0);
      }
    },
  };
}
```

- [ ] **Step 4: Run the detector tests**

Run: `npx vitest run src/detector.test.ts`
Expected: PASS, old and new. Three places where a failure points at the test fixture and not the detector:
- `forgets the name after three readings`: the name is read at reading 1 and the code at reading 4; `4 − 1 ≥ 3`, so it is forgotten.
- `reports the card when its name is read twice`: readings 1 and 3; `3 − 1 < 3`.
- `releases a card dismissed by name…`: the dismissal counts three readings without the card.

- [ ] **Step 5: Keep the callers compiling**

`src/ui/ScanScreen.tsx` (minimal; Task 8 does the real wiring):

```ts
  const detector = useMemo(
    () => createDetector({ find: (code) => match(db, code), findByName: db.findByName, printingsOf: db.printingsOf }),
    [db],
  );
```

`db.findByName` and `db.printingsOf` do not use `this`, so passing them unbound is safe. In `handleFrame`:

```ts
    const detection = detector.feed(read);
    if (!detection || detection.kind !== 'code') return;
```

and in `close`:

```ts
    if (current.detected) detector.dismiss({ kind: 'code', code: current.code, match: match(db, current.code)! });
```

`src/replay.ts`: build the detector the same way, and replace the `detected` line with:

```ts
    detected ??= detector.feed(read);
```

with `let detected: Detection | null = null;` (import `type Detection` from `./detector`). In `scripts/replay.mjs`, replace the `ok` and `detected:` lines with:

```js
    const got = result.detected?.kind === 'code' ? result.detected.code : result.detected?.kind === 'card' ? result.detected.name : null;
    const ok =
      picture.code === null ||
      got === picture.code ||
      (result.detected?.kind === 'card' && picture.name !== null && got === picture.name);
    if (!ok) failures++;
    console.log(`\n${picture.file}  expected ${picture.code ?? '?'} / ${picture.name ?? '?'}`);
    console.log(`  detected: ${result.detected?.kind ?? 'nothing'} ${got ?? ''}  ${ok ? 'OK' : 'MISSED'}`);
```

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

```bash
git add -A src scripts
git commit -m "Combine the card name with the set code to find the card"
```

---

### Task 8: Wire the Scan screen

**Files:**
- Modify: `src/ui/ScanScreen.tsx`

**Interfaces:**
- Consumes: `Detection`, `createDetector` (Task 7); `ResultPanel`'s `initialCard` prop (Task 6).

- [ ] **Step 1: Hold the detection, not just the code**

In `src/ui/ScanScreen.tsx`:

```ts
import { createDetector, type Detection } from '../detector';
```

```ts
// A card the camera found, or nothing yet when the user is typing a code.
type Reading = { id: number; detection: Detection | null };
```

`handleFrame`, last lines:

```ts
    const detection = detector.feed(read);
    if (!detection) return;
    navigator.vibrate?.(60);
    setReading({ id: Date.now(), detection });
```

`close`:

```ts
  // The card is usually still in front of the camera when the panel closes, so
  // it is set aside until it has been taken away.
  function close(current: Reading) {
    if (current.detection) detector.dismiss(current.detection);
    setReading(null);
  }
```

"Type the code" button: `onClick={() => setReading({ id: Date.now(), detection: null })}`.

The panel at the bottom:

```tsx
      {reading && (
        <ResultPanel
          key={reading.id}
          db={db}
          initialCode={reading.detection?.kind === 'code' ? reading.detection.code : ''}
          initialCard={reading.detection?.kind === 'card' ? reading.detection : null}
          hint={null}
          onAdd={(entry) => {
            onAdd(entry);
            close(reading);
          }}
          onClose={() => close(reading)}
        />
      )}
```

Remove the now unused `match` import only if nothing else in the file uses it (the detector's `find` still does).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS.

- [ ] **Step 3: See the name-only panel in a browser**

The replay profile already holds the card database. Run `npm run dev`, then with playwright-core (a short script in the scratchpad, using the same `findChromium` logic and the same persistent profile `node_modules/.cache/replay-profile`, port as printed by Vite) open the app. The camera is not available headless, so the screen shows the manual panel; this checks only that the app starts without a page error after the storage upgrade to version 2 and that the Scan screen renders. Take a screenshot and look at it.

Expected: no `pageerror`; the Scan screen shows either the camera error with the code field, or the camera view.

- [ ] **Step 4: Commit**

```bash
git add src/ui/ScanScreen.tsx
git commit -m "Open the result panel for cards recognised by name"
```

---

### Task 9: Measure on the real pictures and hand over

**Files:**
- Modify: `scripts/replay-pictures.json`, this plan (Baseline section), `docs/superpowers/specs/2026-10-10-card-name-matching-design.md` (only if a constant changed)

- [ ] **Step 1: Replay**

Run: `npm run replay` three times.
Expected: the count detected is at least the Task 1 count, and no picture detected in Task 1 is now MISSED or detected as a different card. `IMG_9755.jpg` should now be detected, by corrected code or by name; if it is not, read its `names` lines in the output and report what was read rather than tuning thresholds to fit one picture.

- [ ] **Step 2: Check the performance targets**

From the three runs, compute the average per reading and compare with the baseline: the rise must be at most 15 %.

Measure the name lookup and index build with a one-off snippet in `src/replay.ts`'s `ready` block (remove it after):

```ts
  let started = performance.now();
  for (let i = 0; i < 200; i++) db.findByName("RENFORT DE L'ARMFE");
  console.log(`name lookup: ${((performance.now() - started) / 200).toFixed(2)} ms`);
```

and log `performance.now()` around `db.load()` minus the same on an empty profile for the index build (or time `buildNameIndex` directly by wrapping the call in `rebuildIndex` temporarily). Print page console messages in `scripts/replay.mjs` with `page.on('console', (message) => console.log(message.text()))` while measuring.

Targets: lookup under 5 ms, build under 300 ms. Record all three numbers in the plan's Baseline section as `Final (Task 9): …`. If a target is missed: reading time → `MAX_NAME_LINES = 1`; lookup → `SHORTLIST = 10`; build → report it, do not restructure.

- [ ] **Step 3: Final checks**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS; remove any temporary measuring code first; `git status` clean apart from intended changes.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Record replay results for card name matching"
```

- [ ] **Step 5: Report to Maxime**

Give, for each picture: the code and the name the app read, and what it detected. Ask Maxime for the real code and name of each card. Put the confirmed values into `scripts/replay-pictures.json` (replacing the provisional ones and the `null`s), run `npm run replay` once more, and commit as `Set the confirmed codes and names of the replay pictures`.
