# Yu-Gi-Oh Card Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable web app that scans the set code on a Yu-Gi-Oh card with the phone camera, identifies the card offline from a subscribed card database, and keeps a per-phone list of scanned cards with their language.

**Architecture:** A React single-page PWA with no backend. Pure-logic modules (`setCode`, `sources`, `cardDatabase`, `cardMatch`, `collection`, `csv`) hold all behaviour and are unit-tested; thin React screens wire them to the camera and Tesseract.js. Card data lives in IndexedDB, the user's list in `localStorage`.

**Tech Stack:** React, TypeScript, Vite, Vitest, Tesseract.js, fake-indexeddb (tests), vite-plugin-pwa, GitHub Pages via GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-09-ygo-scanner-design.md`

## Global Constraints

- Project root is `~/projects/ygo-scanner`. All paths below are relative to it.
- Vite `base` is `'./'` (relative), so the build works under any GitHub Pages repository path. There is no client-side router.
- The interface is English only.
- No Cardmarket links and no prices in this version.
- The only network hosts the app contacts are `db.ygoprodeck.com` (`/api/v7/cardinfo.php`, `/api/v7/checkDBVer.php`) and `cdn.jsdelivr.net` (Tesseract.js worker, core, and English model).
- The card list is stored under the `localStorage` key `ygo-scanner.collection.v1`.
- The card database is stored in an IndexedDB database named `ygo-scanner`.
- Set-code pattern: `[A-Z0-9]{2,5}-[A-Z]{0,2}[A-Z0-9]{3}`. The number is the last 3 characters; the region is the 0–2 letters between the hyphen and the number.
- Do not use regular-expression lookbehind (`(?<=…)`, `(?<!…)`): it fails to parse on iOS versions before 16.4.
- React components have no automated tests. They are verified by `npm run build` (which type-checks) and by hand. All logic that can be wrong lives in the tested modules.
- Tests import `describe`, `it`, `expect`, `vi` explicitly from `vitest` (no globals).
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Creating the GitHub repository and pushing are outward-facing: ask the user before doing either.

## Review Focus

Inputs the spec implies but does not spell out, most likely first. Each has a test in the task named.

1. **Cards with light text on a dark background** (Xyz, Link, some Spell/Trap frames print the code in white). The recognition input must still be dark text on light. — Task 2.
2. **Recognition output with noise around the code** ("1ST LOB-EN001", spaces around the hyphen, an en dash, lowercase typed by hand). The code must still be extracted. — Task 1.
3. **Opening the app with no connection** when a database is already subscribed. The update check must not throw, and the existing data must stay usable. — Task 7.
4. **A CSV that was opened and re-saved in Excel** (byte-order mark, CRLF line ends, semicolons instead of commas on French systems). Import must still read it. — Task 12.
5. **A stored card list that is valid JSON but the wrong shape** (an object, or entries with missing fields, e.g. from an older build). The app must load an empty or filtered list rather than crash. — Task 9.

---

## File Structure

```
index.html                      page shell, iOS meta tags
package.json                    scripts and dependencies
tsconfig.json                   TypeScript settings
vite.config.ts                  Vite, Vitest, and (Task 14) PWA config
.github/workflows/deploy.yml    test, build, deploy to GitHub Pages
scripts/make-icons.mjs          generates the PNG app icons
public/                         generated icons
src/main.tsx                    React entry point
src/App.tsx                     tabs, startup, update check, notices
src/styles.css                  all styles
src/setCode.ts                  extract / parse / language / lookup candidates
src/camera.ts                   camera stream and frame crop
src/ocr/preprocess.ts           greyscale, contrast stretch, invert-if-dark
src/ocr/ocr.ts                  Tesseract.js wrapper
src/sources/types.ts            Printing and Source types
src/sources/ygoprodeck.ts       the YGOPRODeck source
src/sources/index.ts            list of available sources
src/cardDatabase.ts             subscriptions, IndexedDB, find, suggest
src/cardMatch.ts                match a printed code, near-miss suggestions
src/collection.ts               the user's list and its persistence
src/csv.ts                      CSV export and import
src/saveFile.ts                 share-or-download a text file
src/ui/CameraView.tsx           video, aiming frame, capture button
src/ui/ScanScreen.tsx           scan flow
src/ui/ResultPanel.tsx          confirm / correct / language / rarity / add
src/ui/SettingsScreen.tsx       database subscriptions
src/ui/CardsScreen.tsx          the list, export, import
```

Test files sit beside the module they test, named `*.test.ts`.

---

# Milestone 1 — Scan proof

### Task 1: Project scaffold and `setCode`

**Files:**
- Create: `package.json`, `.gitignore`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`
- Create: `src/setCode.ts`
- Test: `src/setCode.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, from `src/setCode.ts`:
  - `type Language` — one of `'English' | 'French' | 'German' | 'Italian' | 'Spanish' | 'Portuguese' | 'Japanese' | 'Korean' | 'Asian English' | 'Traditional Chinese' | 'Simplified Chinese' | 'Unknown'`
  - `const LANGUAGES: Language[]` — all of the above, `'Unknown'` last
  - `const CODE_PATTERN: RegExp` — anchored, matches one whole set code
  - `extract(text: string): string | null`
  - `parse(code: string): { prefix: string; region: string; number: string }`
  - `languageOf(region: string): Language` (the spec calls this `language`; renamed so it does not collide with variables named `language`)
  - `lookupCandidates(code: string): string[]`

- [ ] **Step 1: Create the project files**

`package.json`:

```json
{
  "name": "ygo-scanner",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  }
}
```

`.gitignore`:

```
node_modules
dist
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
});
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#111418" />
    <title>YGO Scanner</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/App.tsx`:

```tsx
export default function App() {
  return (
    <div className="app">
      <header className="topbar">YGO Scanner</header>
    </div>
  );
}
```

`src/styles.css`:

```css
:root {
  --bg: #111418;
  --panel: #1b2027;
  --line: #2c333d;
  --text: #e8eaed;
  --muted: #9aa3ad;
  --accent: #c9a25a;
  --danger: #e0685f;
  color-scheme: dark;
}

* { box-sizing: border-box; }

html, body, #root { height: 100%; margin: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font: 16px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}

button, input, select { font: inherit; color: inherit; }

button {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 14px;
}
button:disabled { opacity: 0.45; }
button.primary { background: var(--accent); border-color: var(--accent); color: #111418; font-weight: 600; }
button.danger { color: var(--danger); }

input, select {
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  width: 100%;
}

.app { display: flex; flex-direction: column; height: 100dvh; }

.topbar {
  padding: calc(env(safe-area-inset-top) + 10px) 16px 10px;
  font-weight: 600;
  border-bottom: 1px solid var(--line);
}

.screen { flex: 1; min-height: 0; overflow-y: auto; position: relative; }
.pad { padding: 16px; }
.muted { color: var(--muted); }
.error { color: var(--danger); }
.stack { display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; gap: 8px; align-items: center; }
.row > .grow { flex: 1; min-width: 0; }
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install react react-dom tesseract.js
npm install -D vite @vitejs/plugin-react typescript vitest @types/react @types/react-dom fake-indexeddb vite-plugin-pwa
```

Expected: both finish without errors and create `package-lock.json`. If npm reports a peer-dependency conflict between `vite-plugin-pwa` and the newest Vite, install the newest Vite major that `vite-plugin-pwa` lists as supported (`npm install -D vite@<that major>`) and rerun; do not use `--force`.

- [ ] **Step 3: Write the failing tests**

`src/setCode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CODE_PATTERN, extract, languageOf, lookupCandidates, parse } from './setCode';

describe('extract', () => {
  it('returns a clean code unchanged', () => {
    expect(extract('LOB-EN001')).toBe('LOB-EN001');
    expect(extract('SDY-046')).toBe('SDY-046');
    expect(extract('MP19-EN001')).toBe('MP19-EN001');
    expect(extract('DUEA-ENSE1')).toBe('DUEA-ENSE1');
  });

  it('uppercases and trims hand-typed input', () => {
    expect(extract(' lob-fr001 ')).toBe('LOB-FR001');
  });

  it('accepts spaces around the hyphen and dash variants', () => {
    expect(extract('LOB - EN001')).toBe('LOB-EN001');
    expect(extract('LOB – EN001')).toBe('LOB-EN001');
    expect(extract('LOB—EN001')).toBe('LOB-EN001');
  });

  it('finds the code among other recognised text', () => {
    expect(extract('1ST LOB-EN001 X')).toBe('LOB-EN001');
    expect(extract('LOB-EN001\n')).toBe('LOB-EN001');
  });

  it('returns null when there is no code', () => {
    expect(extract('')).toBeNull();
    expect(extract('HELLO')).toBeNull();
    expect(extract('LOBEN001')).toBeNull();
  });

  it('rejects a code with too many trailing characters', () => {
    expect(extract('LOB-EN0012')).toBeNull();
  });
});

describe('CODE_PATTERN', () => {
  it('matches only a whole code', () => {
    expect(CODE_PATTERN.test('LOB-EN001')).toBe(true);
    expect(CODE_PATTERN.test('LOB-EN001 ')).toBe(false);
    expect(CODE_PATTERN.test('DB49')).toBe(false);
    expect(CODE_PATTERN.test('MF03-EN0??')).toBe(false);
  });
});

describe('parse', () => {
  it('splits prefix, region and number', () => {
    expect(parse('LOB-FR001')).toEqual({ prefix: 'LOB', region: 'FR', number: '001' });
    expect(parse('SDY-046')).toEqual({ prefix: 'SDY', region: '', number: '046' });
    expect(parse('LOB-E001')).toEqual({ prefix: 'LOB', region: 'E', number: '001' });
    expect(parse('DUEA-ENSE1')).toEqual({ prefix: 'DUEA', region: 'EN', number: 'SE1' });
  });
});

describe('languageOf', () => {
  it('maps every known region', () => {
    const table: [string, string][] = [
      ['EN', 'English'], ['E', 'English'], ['', 'English'],
      ['FR', 'French'], ['F', 'French'],
      ['DE', 'German'], ['G', 'German'],
      ['IT', 'Italian'], ['I', 'Italian'],
      ['SP', 'Spanish'], ['S', 'Spanish'],
      ['PT', 'Portuguese'], ['P', 'Portuguese'],
      ['JP', 'Japanese'],
      ['KR', 'Korean'], ['K', 'Korean'],
      ['AE', 'Asian English'],
      ['TC', 'Traditional Chinese'],
      ['SC', 'Simplified Chinese'],
    ];
    for (const [region, language] of table) expect(languageOf(region)).toBe(language);
  });

  it('returns Unknown for anything else', () => {
    expect(languageOf('ZZ')).toBe('Unknown');
    expect(languageOf('EM')).toBe('Unknown');
  });
});

describe('lookupCandidates', () => {
  it('tries the printed code, then EN, then E, then no region', () => {
    expect(lookupCandidates('LOB-FR001')).toEqual(['LOB-FR001', 'LOB-EN001', 'LOB-E001', 'LOB-001']);
  });

  it('removes duplicates', () => {
    expect(lookupCandidates('LOB-EN001')).toEqual(['LOB-EN001', 'LOB-E001', 'LOB-001']);
    expect(lookupCandidates('SDY-046')).toEqual(['SDY-046', 'SDY-EN046', 'SDY-E046']);
  });

  it('adds a variant with misread letters fixed in the number', () => {
    expect(lookupCandidates('LOB-FRO0I')).toEqual([
      'LOB-FRO0I', 'LOB-FR001',
      'LOB-ENO0I', 'LOB-EN001',
      'LOB-EO0I', 'LOB-E001',
      'LOB-O0I', 'LOB-001',
    ]);
  });

  it('leaves special-edition numbers alone', () => {
    expect(lookupCandidates('DUEA-ENSE1')).toEqual(['DUEA-ENSE1', 'DUEA-ESE1', 'DUEA-SE1']);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/setCode.test.ts`
Expected: FAIL — cannot resolve `./setCode`.

- [ ] **Step 5: Write the implementation**

`src/setCode.ts`:

```ts
export type Language =
  | 'English'
  | 'French'
  | 'German'
  | 'Italian'
  | 'Spanish'
  | 'Portuguese'
  | 'Japanese'
  | 'Korean'
  | 'Asian English'
  | 'Traditional Chinese'
  | 'Simplified Chinese'
  | 'Unknown';

export const LANGUAGES: Language[] = [
  'English',
  'French',
  'German',
  'Italian',
  'Spanish',
  'Portuguese',
  'Japanese',
  'Korean',
  'Asian English',
  'Traditional Chinese',
  'Simplified Chinese',
  'Unknown',
];

const REGION_LANGUAGE: Record<string, Language> = {
  '': 'English', E: 'English', EN: 'English',
  F: 'French', FR: 'French',
  G: 'German', DE: 'German',
  I: 'Italian', IT: 'Italian',
  S: 'Spanish', SP: 'Spanish',
  P: 'Portuguese', PT: 'Portuguese',
  JP: 'Japanese',
  K: 'Korean', KR: 'Korean',
  AE: 'Asian English',
  TC: 'Traditional Chinese',
  SC: 'Simplified Chinese',
};

export const CODE_PATTERN = /^[A-Z0-9]{2,5}-[A-Z]{0,2}[A-Z0-9]{3}$/;

// A code that is not glued to other letters or digits. No lookbehind: it breaks on older iOS.
const CODE_IN_TEXT = /(?:^|[^A-Z0-9])([A-Z0-9]{2,5}-[A-Z]{0,2}[A-Z0-9]{3})(?![A-Z0-9])/;

export function extract(text: string): string | null {
  const cleaned = text
    .toUpperCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, '-');
  const found = CODE_IN_TEXT.exec(cleaned);
  return found ? found[1] : null;
}

export function parse(code: string): { prefix: string; region: string; number: string } {
  const hyphen = code.indexOf('-');
  const prefix = code.slice(0, hyphen);
  const rest = code.slice(hyphen + 1);
  return { prefix, region: rest.slice(0, -3), number: rest.slice(-3) };
}

export function languageOf(region: string): Language {
  return REGION_LANGUAGE[region] ?? 'Unknown';
}

export function lookupCandidates(code: string): string[] {
  const { prefix, region, number } = parse(code);
  const fixed = number.replace(/O/g, '0').replace(/[IL]/g, '1');
  const numbers = fixed === number ? [number] : [number, fixed];
  const candidates: string[] = [];
  for (const r of [region, 'EN', 'E', '']) {
    for (const n of numbers) candidates.push(`${prefix}-${r}${n}`);
  }
  return [...new Set(candidates)];
}
```

- [ ] **Step 6: Run the tests and the build**

Run: `npx vitest run src/setCode.test.ts`
Expected: PASS, all tests green.

Run: `npm run build`
Expected: type-check passes and `dist/` is produced.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Scaffold project and add set-code parsing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Image preprocessing and text recognition

**Files:**
- Create: `src/ocr/preprocess.ts`, `src/ocr/ocr.ts`
- Test: `src/ocr/preprocess.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `toHighContrastGrey(data: Uint8ClampedArray): void` from `src/ocr/preprocess.ts` — rewrites RGBA pixel data in place as stretched greyscale, dark text on light.
  - `recognise(source: HTMLCanvasElement): Promise<string>` from `src/ocr/ocr.ts` — raw recognised text (pass it to `extract`).

- [ ] **Step 1: Write the failing tests**

`src/ocr/preprocess.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toHighContrastGrey } from './preprocess';

function pixels(...greys: number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(greys.length * 4);
  greys.forEach((g, i) => data.set([g, g, g, 255], i * 4));
  return data;
}

function greys(data: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 4) out.push(data[i]);
  return out;
}

describe('toHighContrastGrey', () => {
  it('stretches dark text on a light background to full black and white', () => {
    const data = pixels(150, 150, 100, 150);
    toHighContrastGrey(data);
    expect(greys(data)).toEqual([255, 255, 0, 255]);
  });

  it('inverts light text on a dark background so text ends up dark', () => {
    const data = pixels(40, 40, 220, 40);
    toHighContrastGrey(data);
    expect(greys(data)).toEqual([255, 255, 0, 255]);
  });

  it('writes the same value to red, green and blue and keeps alpha', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 200, 255, 255, 255, 200, 255, 255, 255, 200]);
    toHighContrastGrey(data);
    expect([...data]).toEqual([0, 0, 0, 200, 255, 255, 255, 200, 255, 255, 255, 200]);
  });

  it('leaves a uniform image unchanged', () => {
    const data = pixels(90, 90, 90);
    toHighContrastGrey(data);
    expect(greys(data)).toEqual([90, 90, 90]);
  });

  it('does nothing on empty input', () => {
    const data = new Uint8ClampedArray(0);
    expect(() => toHighContrastGrey(data)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ocr/preprocess.test.ts`
Expected: FAIL — cannot resolve `./preprocess`.

- [ ] **Step 3: Write the implementation**

`src/ocr/preprocess.ts`:

```ts
function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  const target = fraction * total;
  let seen = 0;
  for (let value = 0; value < 256; value++) {
    seen += histogram[value];
    if (seen > 0 && seen >= target) return value;
  }
  return 255;
}

// Rewrites RGBA data in place: greyscale, contrast stretched between the 2nd and
// 98th percentile, and inverted when the image is mostly dark so text is dark on light.
export function toHighContrastGrey(data: Uint8ClampedArray): void {
  const count = data.length / 4;
  if (count === 0) return;

  const grey = new Uint8Array(count);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const g = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
    grey[i] = g;
    histogram[g]++;
  }

  const low = percentile(histogram, count, 0.02);
  const high = percentile(histogram, count, 0.98);
  const range = high - low;
  if (range === 0) return;

  let sum = 0;
  for (let i = 0; i < count; i++) {
    const stretched = Math.max(0, Math.min(255, Math.round(((grey[i] - low) * 255) / range)));
    grey[i] = stretched;
    sum += stretched;
  }

  const mostlyDark = sum / count < 128;
  for (let i = 0; i < count; i++) {
    const value = mostlyDark ? 255 - grey[i] : grey[i];
    const o = i * 4;
    data[o] = value;
    data[o + 1] = value;
    data[o + 2] = value;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ocr/preprocess.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the Tesseract wrapper**

`src/ocr/ocr.ts`:

```ts
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { toHighContrastGrey } from './preprocess';

const SCALE = 3;
const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: WHITELIST,
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      return worker;
    })();
    // A failed load (e.g. offline on first use) must not be remembered forever.
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

export async function recognise(source: HTMLCanvasElement): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = source.width * SCALE;
  canvas.height = source.height * SCALE;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  toHighContrastGrey(image.data);
  context.putImageData(image, 0, 0);

  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  return data.text;
}
```

- [ ] **Step 6: Type-check**

Run: `npm run build`
Expected: passes. If `PSM` or `Worker` are not exported under those names by the installed Tesseract.js version, open `node_modules/tesseract.js/src/index.d.ts`, use the names it exports, and keep `recognise`'s signature unchanged.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add image preprocessing and text recognition" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Camera stream and frame crop

**Files:**
- Create: `src/camera.ts`
- Test: `src/camera.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, from `src/camera.ts`:
  - `type Rect = { x: number; y: number; width: number; height: number }`
  - `sourceRect(video: { width: number; height: number }, element: { width: number; height: number }, frame: Rect): Rect` — converts a rectangle in on-screen element coordinates to video-pixel coordinates, for a video displayed with `object-fit: cover`.
  - `startCamera(video: HTMLVideoElement): Promise<() => void>` — starts the rear camera; resolves to a stop function.
  - `captureFrame(video: HTMLVideoElement, frameElement: HTMLElement): HTMLCanvasElement`
  - `cameraErrorMessage(error: unknown): string`

- [ ] **Step 1: Write the failing tests**

`src/camera.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cameraErrorMessage, sourceRect } from './camera';

describe('sourceRect', () => {
  it('accounts for horizontal cropping when the video is wider than the element', () => {
    const rect = sourceRect(
      { width: 1000, height: 500 },
      { width: 500, height: 500 },
      { x: 100, y: 200, width: 300, height: 50 },
    );
    expect(rect).toEqual({ x: 350, y: 200, width: 300, height: 50 });
  });

  it('accounts for vertical cropping and scaling when the video is taller than the element', () => {
    const rect = sourceRect(
      { width: 400, height: 800 },
      { width: 200, height: 200 },
      { x: 50, y: 50, width: 100, height: 20 },
    );
    expect(rect).toEqual({ x: 100, y: 300, width: 200, height: 40 });
  });

  it('maps one to one when sizes match', () => {
    const rect = sourceRect(
      { width: 640, height: 480 },
      { width: 640, height: 480 },
      { x: 10, y: 20, width: 30, height: 40 },
    );
    expect(rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
});

describe('cameraErrorMessage', () => {
  it('explains a denied permission', () => {
    const error = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    expect(cameraErrorMessage(error)).toMatch(/denied/i);
    expect(cameraErrorMessage(error)).toMatch(/settings/i);
  });

  it('reports other failures with their message', () => {
    expect(cameraErrorMessage(new Error('no device'))).toContain('no device');
    expect(cameraErrorMessage('odd')).toContain('odd');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/camera.test.ts`
Expected: FAIL — cannot resolve `./camera`.

- [ ] **Step 3: Write the implementation**

`src/camera.ts`:

```ts
export type Rect = { x: number; y: number; width: number; height: number };

type Size = { width: number; height: number };

// The video is shown with object-fit: cover, so it is scaled to fill the element
// and cropped equally on the overflowing sides.
export function sourceRect(video: Size, element: Size, frame: Rect): Rect {
  const scale = Math.max(element.width / video.width, element.height / video.height);
  const offsetX = (element.width - video.width * scale) / 2;
  const offsetY = (element.height - video.height * scale) / 2;
  return {
    x: (frame.x - offsetX) / scale,
    y: (frame.y - offsetY) / scale,
    width: frame.width / scale,
    height: frame.height / scale,
  };
}

export async function startCamera(video: HTMLVideoElement): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('this browser does not give web pages access to the camera');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = stream;
  await video.play();
  return () => stream.getTracks().forEach((track) => track.stop());
}

export function captureFrame(video: HTMLVideoElement, frameElement: HTMLElement): HTMLCanvasElement {
  const videoBox = video.getBoundingClientRect();
  const frameBox = frameElement.getBoundingClientRect();
  const source = sourceRect(
    { width: video.videoWidth, height: video.videoHeight },
    { width: videoBox.width, height: videoBox.height },
    {
      x: frameBox.left - videoBox.left,
      y: frameBox.top - videoBox.top,
      width: frameBox.width,
      height: frameBox.height,
    },
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width);
  canvas.height = Math.round(source.height);
  canvas
    .getContext('2d')!
    .drawImage(video, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function cameraErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return 'Camera access was denied. Allow the camera for this site in your browser settings, then reload.';
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `The camera is not available: ${detail}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/camera.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add camera stream and frame crop" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Bare scan screen

**Files:**
- Create: `src/ui/CameraView.tsx`, `src/ui/ScanScreen.tsx`
- Modify: `src/App.tsx` (replace whole file), `src/styles.css` (append)

**Interfaces:**
- Consumes: `startCamera`, `captureFrame`, `cameraErrorMessage` (Task 3); `recognise` (Task 2); `extract`, `parse`, `languageOf` (Task 1).
- Produces:
  - `CameraView` from `src/ui/CameraView.tsx` with props `{ busy: boolean; onCapture: (canvas: HTMLCanvasElement) => void; onError: (message: string) => void }`. It owns the camera lifetime: starts on mount, stops on unmount.
  - `ScanScreen` from `src/ui/ScanScreen.tsx` with no props (Task 11 replaces it with a version that takes props).

- [ ] **Step 1: Write `CameraView`**

`src/ui/CameraView.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { cameraErrorMessage, captureFrame, startCamera } from '../camera';

type Props = {
  busy: boolean;
  onCapture: (canvas: HTMLCanvasElement) => void;
  onError: (message: string) => void;
};

export function CameraView({ busy, onCapture, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    startCamera(videoRef.current!)
      .then((stopCamera) => {
        if (cancelled) {
          stopCamera();
          return;
        }
        stop = stopCamera;
        setRunning(true);
      })
      .catch((error) => {
        if (!cancelled) onError(cameraErrorMessage(error));
      });
    return () => {
      cancelled = true;
      stop?.();
    };
    // The camera is started once per mount; onError is not a dependency on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="camera">
      <video ref={videoRef} playsInline muted autoPlay />
      <div className="camera-frame" ref={frameRef} />
      <p className="camera-hint">Line the set code up inside the frame</p>
      <button
        className="primary camera-capture"
        disabled={!running || busy}
        onClick={() => onCapture(captureFrame(videoRef.current!, frameRef.current!))}
      >
        {busy ? 'Reading…' : 'Scan'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write the bare `ScanScreen`**

`src/ui/ScanScreen.tsx`:

```tsx
import { useState } from 'react';
import { recognise } from '../ocr/ocr';
import { extract, languageOf, parse } from '../setCode';
import { CameraView } from './CameraView';

type Reading = { raw: string; code: string | null; milliseconds: number; preview: string };

export function ScanScreen() {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleCapture(canvas: HTMLCanvasElement) {
    setBusy(true);
    setFailure(null);
    const started = performance.now();
    try {
      const raw = await recognise(canvas);
      setReading({
        raw,
        code: extract(raw),
        milliseconds: Math.round(performance.now() - started),
        preview: canvas.toDataURL('image/png'),
      });
    } catch (error) {
      setFailure(`Reading failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  if (cameraError) {
    return <p className="pad error">{cameraError}</p>;
  }

  return (
    <div className="scan">
      <CameraView busy={busy} onCapture={handleCapture} onError={setCameraError} />
      <div className="scan-result pad stack">
        {failure && <p className="error">{failure}</p>}
        {!reading && !failure && <p className="muted">Nothing scanned yet.</p>}
        {reading && (
          <>
            <img className="scan-preview" src={reading.preview} alt="Scanned area" />
            <div>
              <strong>{reading.code ?? 'No code found — move closer and retry'}</strong>
              {reading.code && <span className="muted"> · {languageOf(parse(reading.code).region)}</span>}
            </div>
            <div className="muted">
              Raw text: “{reading.raw.trim()}” · {reading.milliseconds} ms
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace `src/App.tsx`**

```tsx
import { ScanScreen } from './ui/ScanScreen';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">YGO Scanner</header>
      <main className="screen">
        <ScanScreen />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Append to `src/styles.css`**

```css
.scan { display: flex; flex-direction: column; height: 100%; }

.camera { position: relative; flex: 1; min-height: 240px; background: #000; overflow: hidden; }
.camera video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

.camera-frame {
  position: absolute;
  left: 15%;
  width: 70%;
  top: 50%;
  aspect-ratio: 5 / 1;
  transform: translateY(-50%);
  border: 2px solid var(--accent);
  border-radius: 6px;
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45);
}

.camera-hint {
  position: absolute;
  left: 0;
  right: 0;
  top: 12px;
  margin: 0;
  text-align: center;
  text-shadow: 0 1px 3px #000;
}

.camera-capture { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); min-width: 140px; }

.scan-result { border-top: 1px solid var(--line); }
.scan-preview { max-width: 100%; border: 1px solid var(--line); border-radius: 4px; background: #fff; }
```

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: all tests pass.

Run: `npm run build`
Expected: passes.

Run: `npm run dev`, open the printed local URL in a desktop browser.
Expected: the top bar reads "YGO Scanner". With a webcam, the preview and gold frame appear and the Scan button reports a reading. With no webcam, the screen shows a red "The camera is not available…" message. Stop the dev server afterwards.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add bare scan screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Deploy to GitHub Pages and test on a phone

This task ends milestone 1. It needs the user and is the go/no-go check on recognition quality.

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `npm test`, `npm run build` (Task 1).
- Produces: a public HTTPS URL serving `dist/`, redeployed on every push to `main`.

- [ ] **Step 1: Write the workflow**

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "Add GitHub Pages deploy workflow" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Ask the user to set up hosting**

The deploy runs from `main`, so the work so far must be on `main` before this step. Stop and ask the user to:

1. Create an empty GitHub repository (suggested name `ygo-scanner`) and give its URL. A free GitHub account only serves Pages from a **public** repository; say so.
2. Confirm that the code may be pushed there.

Then, with their confirmation:

```bash
git remote add origin <repository URL from the user>
git push -u origin main
```

Ask the user to open the repository's **Settings → Pages** and set **Source** to **GitHub Actions**, then re-run the workflow from the **Actions** tab if the first run failed before that setting existed.

Expected: the Deploy workflow finishes green and prints the site URL (`https://<user>.github.io/<repo>/`).

- [ ] **Step 4: Phone test (user)**

Ask the user to open the site URL on their phone, allow the camera, and scan at least 10 cards, covering if possible: an old card and a recent one, a card with a white code on a dark frame (Xyz or Link), and a non-English card. For each, note whether the code shown is correct and the reading time.

Go/no-go, to be decided with the user:

- **Go** if most cards read correctly within a few seconds, possibly after a second attempt. Continue to Task 6.
- **Tune** if readings are close but wrong (a character off, or text cut off). Adjust in this order, redeploy, and retest: the frame size in `.camera-frame`, `SCALE` in `src/ocr/ocr.ts`, the percentiles in `src/ocr/preprocess.ts`.
- **Stop** if readings are mostly garbage after tuning. Do not start milestone 2; report to the user and revisit the approach (the spec's option C, a cloud recognition service, is the fallback).

---

# Milestone 2 — Databases and matching

### Task 6: Card sources

**Files:**
- Create: `src/sources/types.ts`, `src/sources/ygoprodeck.ts`, `src/sources/index.ts`
- Test: `src/sources/ygoprodeck.test.ts`

**Interfaces:**
- Consumes: `CODE_PATTERN` from `src/setCode.ts` (Task 1).
- Produces:
  - From `src/sources/types.ts`:
    - `type Printing = { code: string; name: string; setName: string; rarity: string }`
    - `type Source = { id: string; name: string; fetchVersion(): Promise<string>; fetchPrintings(): Promise<Printing[]> }`
  - From `src/sources/ygoprodeck.ts`: `flatten(json: unknown): Printing[]`, `const ygoprodeck: Source` (id `'ygoprodeck'`).
  - From `src/sources/index.ts`: `const SOURCES: Source[]`.

- [ ] **Step 1: Write the types**

`src/sources/types.ts`:

```ts
export type Printing = {
  code: string; // as indexed by the source, e.g. "LOB-EN001"
  name: string;
  setName: string;
  rarity: string;
};

export type Source = {
  id: string;
  name: string; // shown in Settings
  fetchVersion(): Promise<string>;
  fetchPrintings(): Promise<Printing[]>;
};
```

- [ ] **Step 2: Write the failing tests**

`src/sources/ygoprodeck.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/sources/ygoprodeck.test.ts`
Expected: FAIL — cannot resolve `./ygoprodeck`.

- [ ] **Step 4: Write the implementation**

`src/sources/ygoprodeck.ts`:

```ts
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

async function getJson(path: string, what: string): Promise<unknown> {
  const response = await fetch(`${API}/${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${what} failed (HTTP ${response.status})`);
  return response.json();
}

export const ygoprodeck: Source = {
  id: 'ygoprodeck',
  name: 'YGOPRODeck — all Yu-Gi-Oh! TCG cards',

  async fetchVersion() {
    const json = await getJson('checkDBVer.php', 'Version check');
    const version = (json as { database_version?: unknown }[] | null)?.[0]?.database_version;
    if (typeof version !== 'string') throw new Error('Unexpected version format');
    return version;
  },

  async fetchPrintings() {
    return flatten(await getJson('cardinfo.php', 'Card download'));
  },
};
```

`src/sources/index.ts`:

```ts
import type { Source } from './types';
import { ygoprodeck } from './ygoprodeck';

export const SOURCES: Source[] = [ygoprodeck];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/sources/ygoprodeck.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add card sources with the YGOPRODeck source" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Card database with subscriptions

**Files:**
- Create: `src/cardDatabase.ts`
- Test: `src/cardDatabase.test.ts`

**Interfaces:**
- Consumes: `Printing`, `Source` from `src/sources/types.ts` (Task 6).
- Produces, from `src/cardDatabase.ts`:
  - `type Subscription = { sourceId: string; version: string; updatedAt: string; checkedAt: string; count: number; lastError: string | null }`
  - `type UpdateResult = { sourceId: string; updated: boolean; added: number; error: string | null }`
  - `type Phase = 'downloading' | 'saving'`
  - `withinOne(a: string, b: string): boolean` — true when the strings differ by exactly one insertion, deletion, or substitution.
  - `createCardDatabase(sources: Source[], idb: IDBFactory, now?: () => string): CardDatabase`
  - `type CardDatabase` with methods:
    - `load(): Promise<void>` — reads stored subscriptions and printings into memory. Call once before anything else.
    - `subscriptions(): Subscription[]`
    - `subscribe(sourceId: string, onProgress?: (phase: Phase) => void): Promise<void>`
    - `unsubscribe(sourceId: string): Promise<void>`
    - `checkForUpdates(): Promise<UpdateResult[]>` — never rejects.
    - `forceRefresh(sourceId: string, onProgress?: (phase: Phase) => void): Promise<void>`
    - `hasData(): boolean`
    - `find(code: string): Printing[]`
    - `suggest(code: string): string[]` — up to 5 known codes at edit distance 1, sorted.

The spec's `onProgress` is a phase callback, not a percentage: the download is a single compressed response whose total size the browser does not reliably report.

- [ ] **Step 1: Write the failing tests**

`src/cardDatabase.test.ts`:

```ts
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createCardDatabase, withinOne } from './cardDatabase';
import type { Printing, Source } from './sources/types';

// A fresh, empty in-memory IndexedDB per call, typed as the browser's factory.
const freshIdb = (): IDBFactory => new FakeIDBFactory() as unknown as IDBFactory;

const BEWD: Printing = { code: 'LOB-EN001', name: 'Blue-Eyes White Dragon', setName: 'LOB', rarity: 'Ultra Rare' };
const DM: Printing = { code: 'LOB-EN005', name: 'Dark Magician', setName: 'LOB', rarity: 'Ultra Rare' };
const ULTRA: Printing = { code: 'RA01-EN010', name: 'Two Rarities', setName: 'RA01', rarity: 'Ultra Rare' };
const SECRET: Printing = { code: 'RA01-EN010', name: 'Two Rarities', setName: 'RA01', rarity: 'Secret Rare' };

function fakeSource(id: string, printings: Printing[]) {
  const state = { version: '1', printings, fail: false, versionCalls: 0, printingsCalls: 0 };
  const source: Source = {
    id,
    name: `Fake ${id}`,
    async fetchVersion() {
      state.versionCalls++;
      if (state.fail) throw new Error('offline');
      return state.version;
    },
    async fetchPrintings() {
      state.printingsCalls++;
      if (state.fail) throw new Error('offline');
      return state.printings;
    },
  };
  return { source, state };
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

  it('suggests up to five known codes one edit away, sorted', async () => {
    const codes = ['LOB-EN001', 'LOB-EN002', 'LOB-EN003', 'LOB-EN004', 'LOB-EN005', 'LOB-EN006', 'SDK-001'];
    const printings = codes.map((code) => ({ code, name: code, setName: 'S', rarity: 'Common' }));
    const { source } = fakeSource('a', printings);
    const db = createCardDatabase([source], freshIdb());
    await db.load();
    await db.subscribe('a');

    expect(db.suggest('LOB-EN00X')).toEqual(['LOB-EN001', 'LOB-EN002', 'LOB-EN003', 'LOB-EN004', 'LOB-EN005']);
    expect(db.suggest('L0B-EN001')).toEqual(['LOB-EN001']);
    expect(db.suggest('ZZZ-EN999')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cardDatabase.test.ts`
Expected: FAIL — cannot resolve `./cardDatabase`.

- [ ] **Step 3: Write the implementation**

`src/cardDatabase.ts`:

```ts
import type { Printing, Source } from './sources/types';

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
const MAX_SUGGESTIONS = 5;

function openDatabase(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SUBSCRIPTIONS, { keyPath: 'sourceId' });
      // One record per source: key = sourceId, value = Printing[].
      request.result.createObjectStore(PRINTINGS);
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

  function rebuildIndex(): void {
    byCode = new Map();
    const seen = new Set<string>();
    for (const printings of printingsBySource.values()) {
      for (const printing of printings) {
        const key = printingKey(printing);
        if (seen.has(key)) continue;
        seen.add(key);
        const list = byCode.get(printing.code);
        if (list) list.push(printing);
        else byCode.set(printing.code, [printing]);
      }
    }
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

  async function download(sourceId: string, onProgress?: (phase: Phase) => void): Promise<number> {
    const source = sourceById(sourceId);
    onProgress?.('downloading');
    const [version, printings] = await Promise.all([source.fetchVersion(), source.fetchPrintings()]);
    if (printings.length === 0) throw new Error('The database returned no cards');

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

  async function downloadOrRecord(sourceId: string, onProgress?: (phase: Phase) => void): Promise<void> {
    try {
      await download(sourceId, onProgress);
    } catch (error) {
      await recordError(sourceId, messageOf(error));
      throw error;
    }
  }

  return {
    async load(): Promise<void> {
      const db = await openDatabase(idb);
      try {
        const transaction = db.transaction([SUBSCRIPTIONS, PRINTINGS], 'readonly');
        // All requests are issued before the first await: an IndexedDB transaction
        // closes itself once control returns to the event loop with nothing pending.
        const [stored, keys, values] = await Promise.all([
          result<Subscription[]>(transaction.objectStore(SUBSCRIPTIONS).getAll()),
          result<IDBValidKey[]>(transaction.objectStore(PRINTINGS).getAllKeys()),
          result<Printing[][]>(transaction.objectStore(PRINTINGS).getAll()),
        ]);
        const savedPrintings = new Map(keys.map((key, i) => [String(key), values[i]]));
        subscriptionsById.clear();
        printingsBySource.clear();
        for (const subscription of stored) {
          subscriptionsById.set(subscription.sourceId, subscription);
          printingsBySource.set(subscription.sourceId, savedPrintings.get(subscription.sourceId) ?? []);
        }
      } finally {
        db.close();
      }
      rebuildIndex();
    },

    subscriptions(): Subscription[] {
      return [...subscriptionsById.values()];
    },

    subscribe(sourceId: string, onProgress?: (phase: Phase) => void): Promise<void> {
      return downloadOrRecord(sourceId, onProgress);
    },

    async unsubscribe(sourceId: string): Promise<void> {
      const db = await openDatabase(idb);
      try {
        const transaction = db.transaction([SUBSCRIPTIONS, PRINTINGS], 'readwrite');
        transaction.objectStore(SUBSCRIPTIONS).delete(sourceId);
        transaction.objectStore(PRINTINGS).delete(sourceId);
        await finished(transaction);
      } finally {
        db.close();
      }
      subscriptionsById.delete(sourceId);
      printingsBySource.delete(sourceId);
      rebuildIndex();
    },

    async checkForUpdates(): Promise<UpdateResult[]> {
      const results: UpdateResult[] = [];
      for (const subscription of [...subscriptionsById.values()]) {
        const { sourceId } = subscription;
        try {
          const version = await sourceById(sourceId).fetchVersion();
          if (version === subscription.version) {
            const next = { ...subscription, checkedAt: now(), lastError: null };
            await store(next, null);
            subscriptionsById.set(sourceId, next);
            results.push({ sourceId, updated: false, added: 0, error: null });
          } else {
            const added = await download(sourceId);
            results.push({ sourceId, updated: true, added, error: null });
          }
        } catch (error) {
          const message = messageOf(error);
          await recordError(sourceId, message);
          results.push({ sourceId, updated: false, added: 0, error: message });
        }
      }
      return results;
    },

    async forceRefresh(sourceId: string, onProgress?: (phase: Phase) => void): Promise<void> {
      if (!subscriptionsById.has(sourceId)) throw new Error(`Not subscribed to ${sourceId}`);
      await downloadOrRecord(sourceId, onProgress);
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
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cardDatabase.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add card database with subscriptions and update checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Card matching

**Files:**
- Create: `src/cardMatch.ts`
- Test: `src/cardMatch.test.ts`

**Interfaces:**
- Consumes: `lookupCandidates`, `parse` (Task 1); `Printing` (Task 6); the `find` and `suggest` methods of `CardDatabase` (Task 7).
- Produces, from `src/cardMatch.ts`:
  - `type Lookup = { find(code: string): Printing[]; suggest(code: string): string[] }` (a `CardDatabase` satisfies it)
  - `type Match = { printings: Printing[]; matchedCode: string }`
  - `match(db: Lookup, code: string): Match | null`
  - `suggestions(db: Lookup, code: string): string[]` — up to 5 codes in the **printed** form (original region kept) that each resolve with `match`.

- [ ] **Step 1: Write the failing tests**

`src/cardMatch.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cardMatch.test.ts`
Expected: FAIL — cannot resolve `./cardMatch`.

- [ ] **Step 3: Write the implementation**

`src/cardMatch.ts`:

```ts
import { lookupCandidates, parse } from './setCode';
import type { Printing } from './sources/types';

export type Lookup = {
  find(code: string): Printing[];
  suggest(code: string): string[];
};

export type Match = { printings: Printing[]; matchedCode: string };

const MAX_SUGGESTIONS = 5;

export function match(db: Lookup, code: string): Match | null {
  for (const candidate of lookupCandidates(code)) {
    const printings = db.find(candidate);
    if (printings.length > 0) return { printings, matchedCode: candidate };
  }
  return null;
}

// Near misses are found on the database's (English) form of the code, then put
// back into the printed form so the language of the card is not lost.
export function suggestions(db: Lookup, code: string): string[] {
  const { region } = parse(code);
  const found = new Set<string>();
  for (const candidate of lookupCandidates(code)) {
    for (const near of db.suggest(candidate)) {
      const { prefix, number } = parse(near);
      const printed = `${prefix}-${region}${number}`;
      if (printed === code || found.has(printed) || match(db, printed) === null) continue;
      found.add(printed);
      if (found.size === MAX_SUGGESTIONS) return [...found];
    }
  }
  return [...found];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cardMatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add card matching and near-miss suggestions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The card list (`collection`)

**Files:**
- Create: `src/collection.ts`
- Test: `src/collection.test.ts`

**Interfaces:**
- Consumes: `Language`, `LANGUAGES`, `CODE_PATTERN` (Task 1).
- Produces, from `src/collection.ts`:
  - `const STORAGE_KEY = 'ygo-scanner.collection.v1'`
  - `type Entry = { code: string; matchedCode: string; language: Language; name: string; setName: string; rarity: string; quantity: number; addedAt: string }`
  - `type NewEntry = Omit<Entry, 'quantity' | 'addedAt'>`
  - `entryKey(entry: Pick<Entry, 'code' | 'language' | 'rarity'>): string`
  - `isEntry(value: unknown): value is Entry`
  - `createCollection(storage: Pick<Storage, 'getItem' | 'setItem'>, now?: () => string): Collection`
  - `type Collection` with methods, where every mutator returns `true` if the list was saved to storage and `false` if the write failed (the in-memory list is updated either way):
    - `all(): Entry[]` — a new array reference after every change
    - `add(entry: NewEntry): boolean`
    - `setQuantity(key: string, quantity: number): boolean` — a quantity below 1 removes the entry
    - `remove(key: string): boolean`
    - `replaceAll(entries: Entry[]): boolean`
    - `merge(entries: Entry[]): boolean` — adds quantities for matching keys, appends the rest

- [ ] **Step 1: Write the failing tests**

`src/collection.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/collection.test.ts`
Expected: FAIL — cannot resolve `./collection`.

- [ ] **Step 3: Write the implementation**

`src/collection.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/collection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add the card list with local persistence" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Settings screen, tabs, and update check on app open

**Files:**
- Create: `src/ui/SettingsScreen.tsx`
- Modify: `src/App.tsx` (replace whole file), `src/styles.css` (append)

**Interfaces:**
- Consumes: `createCardDatabase`, `CardDatabase`, `Phase`, `UpdateResult` (Task 7); `SOURCES`, `Source` (Task 6); `ScanScreen` with no props (Task 4).
- Produces:
  - `SettingsScreen` with props `{ db: CardDatabase; sources: Source[]; onChange: () => void }`. `onChange` is called after every subscribe, unsubscribe, or refresh attempt so the parent re-renders.
  - `App` holding: the module-level `db`; state `tab: 'scan' | 'settings'`, `ready`, `notice`; a `refresh()` function that forces a re-render; a bottom tab bar. Tasks 11 and 13 edit this file.

- [ ] **Step 1: Write `SettingsScreen`**

`src/ui/SettingsScreen.tsx`:

```tsx
import { useState } from 'react';
import type { CardDatabase, Phase } from '../cardDatabase';
import type { Source } from '../sources/types';

type Props = { db: CardDatabase; sources: Source[]; onChange: () => void };

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function SettingsScreen({ db, sources, onChange }: Props) {
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function run(sourceId: string, action: (onProgress: (phase: Phase) => void) => Promise<void>) {
    setErrors((current) => ({ ...current, [sourceId]: '' }));
    setBusy((current) => ({ ...current, [sourceId]: 'Starting…' }));
    try {
      await action((phase) =>
        setBusy((current) => ({ ...current, [sourceId]: phase === 'downloading' ? 'Downloading…' : 'Saving…' })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrors((current) => ({ ...current, [sourceId]: message }));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[sourceId];
        return next;
      });
      onChange();
    }
  }

  function unsubscribe(source: Source) {
    const question = `Unsubscribe from “${source.name}”? Its data is deleted from this phone. Your card list is kept.`;
    if (window.confirm(question)) void run(source.id, () => db.unsubscribe(source.id));
  }

  return (
    <div className="pad stack">
      <h2>Card databases</h2>
      {sources.map((source) => {
        const subscription = db.subscriptions().find((s) => s.sourceId === source.id);
        const working = busy[source.id];
        const error = errors[source.id] || subscription?.lastError;
        return (
          <section className="card stack" key={source.id}>
            <div className="row">
              <strong className="grow">{source.name}</strong>
              {subscription ? (
                <button className="danger" disabled={!!working} onClick={() => unsubscribe(source)}>
                  Unsubscribe
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!!working}
                  onClick={() => void run(source.id, (onProgress) => db.subscribe(source.id, onProgress))}
                >
                  Subscribe
                </button>
              )}
            </div>

            {subscription && (
              <>
                <div className="muted">
                  Version {subscription.version} · {subscription.count.toLocaleString()} printings
                  <br />
                  Updated {when(subscription.updatedAt)}
                  <br />
                  Last checked {when(subscription.checkedAt)}
                </div>
                <button
                  disabled={!!working}
                  onClick={() => void run(source.id, (onProgress) => db.forceRefresh(source.id, onProgress))}
                >
                  Force refresh
                </button>
              </>
            )}

            {working && <div className="muted">{working}</div>}
            {!working && error && <div className="error">Last attempt failed: {error}</div>}
          </section>
        );
      })}
      <p className="muted">
        Subscribed databases are checked for new cards each time the app opens. Scanning works offline once a database
        is downloaded.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { createCardDatabase, type UpdateResult } from './cardDatabase';
import { SOURCES } from './sources';
import { ScanScreen } from './ui/ScanScreen';
import { SettingsScreen } from './ui/SettingsScreen';

type Tab = 'scan' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'scan', label: 'Scan' },
  { id: 'settings', label: 'Settings' },
];

const db = createCardDatabase(SOURCES, indexedDB);

// Memoised at module level so React StrictMode's double effect run in development
// does not load or check twice.
let loading: Promise<void> | null = null;
let checking: Promise<UpdateResult[]> | null = null;
const loadOnce = () => (loading ??= db.load());
const checkOnce = () => (checking ??= db.checkForUpdates());

export default function App() {
  const [tab, setTab] = useState<Tab>('scan');
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setRevision] = useState(0);
  const refresh = () => setRevision((revision) => revision + 1);

  useEffect(() => {
    let active = true;
    loadOnce()
      .then(() => {
        if (active) setReady(true);
        return checkOnce();
      })
      .then((results) => {
        if (!active) return;
        refresh();
        const updated = results.filter((result) => result.updated);
        if (updated.length > 0) {
          const added = updated.reduce((sum, result) => sum + result.added, 0);
          setNotice(`Card database updated — ${added.toLocaleString()} new printings`);
        }
      })
      .catch(() => {
        if (!active) return;
        setReady(true);
        setNotice('Could not open card database storage on this phone.');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="app">
      <header className="topbar">YGO Scanner</header>
      <main className="screen">
        {!ready && <p className="pad muted">Loading…</p>}
        {ready && tab === 'scan' && <ScanScreen />}
        {ready && tab === 'settings' && <SettingsScreen db={db} sources={SOURCES} onChange={refresh} />}
        {notice && (
          <div className="notice" role="status" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
      </main>
      <nav className="tabs">
        {TABS.map(({ id, label }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
```

- [ ] **Step 3: Append to `src/styles.css`**

```css
h2 { margin: 0; font-size: 1.1rem; }

.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }

.tabs {
  display: flex;
  border-top: 1px solid var(--line);
  padding-bottom: env(safe-area-inset-bottom);
}
.tabs button { flex: 1; border: 0; border-radius: 0; background: none; padding: 14px 0; color: var(--muted); }
.tabs button.active { color: var(--accent); font-weight: 600; }

.notice {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  background: var(--accent);
  color: #111418;
  border-radius: 10px;
  padding: 12px 14px;
  font-weight: 600;
  z-index: 10;
}
```

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: all tests pass.

Run: `npm run build`
Expected: passes.

Run: `npm run dev`, open the app in a desktop browser, go to **Settings**.
Expected:
- "YGOPRODeck — all Yu-Gi-Oh! TCG cards" is listed with a **Subscribe** button.
- Pressing Subscribe shows "Downloading…" then "Saving…", then the version, a printings count near 44,000, and the two dates.
- Reloading the page keeps the subscription, and "Last checked" moves to the current time.
- **Force refresh** downloads again and updates "Updated".
- With the browser's network set to offline in dev tools, reload: no error popup appears; Settings shows "Last attempt failed: …" on the row and the data is still listed.
- **Unsubscribe** asks for confirmation, then the row returns to the Subscribe state.

Stop the dev server afterwards.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add settings screen, tabs, and update check on app open" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Result panel and full scan flow

**Files:**
- Create: `src/ui/ResultPanel.tsx`
- Modify: `src/ui/ScanScreen.tsx` (replace whole file), `src/App.tsx` (four edits), `src/styles.css` (append)

**Interfaces:**
- Consumes: `CameraView` (Task 4); `recognise` (Task 2); `extract`, `parse`, `languageOf`, `LANGUAGES`, `Language` (Task 1); `match`, `suggestions` (Task 8); `CardDatabase` (Task 7); `createCollection`, `Entry`, `NewEntry` (Task 9).
- Produces:
  - `ResultPanel` with props `{ db: CardDatabase; initialCode: string; hint: string | null; onAdd: (entry: NewEntry) => void; onClose: (() => void) | null }`. `onClose` null hides the Retry button (used for manual entry when there is no camera).
  - `ScanScreen` with props `{ db: CardDatabase; onAdd: (entry: NewEntry) => void; onOpenSettings: () => void }`.
  - In `App`: module-level `collection`, state `entries: Entry[]`, and `handleAdd(entry: NewEntry): void`.

- [ ] **Step 1: Write `ResultPanel`**

`src/ui/ResultPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { CardDatabase } from '../cardDatabase';
import { match, suggestions } from '../cardMatch';
import type { NewEntry } from '../collection';
import { extract, LANGUAGES, languageOf, parse, type Language } from '../setCode';

type Props = {
  db: CardDatabase;
  initialCode: string;
  hint: string | null;
  onAdd: (entry: NewEntry) => void;
  onClose: (() => void) | null;
};

export function ResultPanel({ db, initialCode, hint, onAdd, onClose }: Props) {
  const [text, setText] = useState(initialCode);
  const code = extract(text);
  const found = code ? match(db, code) : null;
  const near = code && !found ? suggestions(db, code) : [];
  const rarities = found ? [...new Set(found.printings.map((p) => p.rarity))] : [];

  const [language, setLanguage] = useState<Language>('Unknown');
  const [rarity, setRarity] = useState('');

  // Whenever the code changes, restart from what the code itself says.
  useEffect(() => {
    setLanguage(code ? languageOf(parse(code).region) : 'Unknown');
    setRarity(rarities.length === 1 ? rarities[0] : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, found?.matchedCode]);

  const printing = found?.printings.find((p) => p.rarity === rarity) ?? null;
  const canAdd = !!code && !!found && !!printing && language !== 'Unknown';

  function add() {
    if (!code || !found || !printing || language === 'Unknown') return;
    onAdd({
      code,
      matchedCode: found.matchedCode,
      language,
      name: printing.name,
      setName: printing.setName,
      rarity: printing.rarity,
    });
  }

  return (
    <div className="result pad stack">
      {hint && <p className="muted">{hint}</p>}

      <label className="stack">
        <span className="muted">Set code</span>
        <input
          value={text}
          onChange={(event) => setText(event.target.value.toUpperCase())}
          placeholder="LOB-EN001"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>

      {code && found && (
        <div>
          <strong>{found.printings[0].name}</strong>
          <div className="muted">{found.printings[0].setName}</div>
        </div>
      )}

      {code && !found && (
        <div className="stack">
          <div className="error">Card not found</div>
          {near.length > 0 && (
            <div className="row wrap">
              <span className="muted">Did you mean</span>
              {near.map((suggestion) => (
                <button key={suggestion} onClick={() => setText(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {found && (
        <label className="stack">
          <span className="muted">Language</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
            {LANGUAGES.map((option) => (
              <option key={option} value={option}>
                {option === 'Unknown' ? 'Unknown — choose one' : option}
              </option>
            ))}
          </select>
        </label>
      )}

      {found && rarities.length > 1 && (
        <label className="stack">
          <span className="muted">Rarity — this code exists in several</span>
          <select value={rarity} onChange={(event) => setRarity(event.target.value)}>
            <option value="">Choose a rarity</option>
            {rarities.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )}

      {found && rarities.length === 1 && <div className="muted">{rarities[0]}</div>}

      <div className="row">
        {onClose && (
          <button className="grow" onClick={onClose}>
            Retry
          </button>
        )}
        <button className="primary grow" disabled={!canAdd} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/ui/ScanScreen.tsx`**

```tsx
import { useState } from 'react';
import type { CardDatabase } from '../cardDatabase';
import type { NewEntry } from '../collection';
import { recognise } from '../ocr/ocr';
import { extract } from '../setCode';
import { CameraView } from './CameraView';
import { ResultPanel } from './ResultPanel';

type Props = {
  db: CardDatabase;
  onAdd: (entry: NewEntry) => void;
  onOpenSettings: () => void;
};

type Reading = { id: number; code: string; hint: string | null };

const NO_CODE = 'No code found — move closer and retry, or type the code.';

export function ScanScreen({ db, onAdd, onOpenSettings }: Props) {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [manualId, setManualId] = useState(0);

  if (!db.hasData()) {
    return (
      <div className="pad stack">
        <p>To identify cards, subscribe to a card database first. It is downloaded once and then works offline.</p>
        <button className="primary" onClick={onOpenSettings}>
          Open Settings
        </button>
      </div>
    );
  }

  async function handleCapture(canvas: HTMLCanvasElement) {
    setBusy(true);
    try {
      const raw = await recognise(canvas);
      const code = extract(raw);
      setReading({ id: Date.now(), code: code ?? raw.trim(), hint: code ? null : NO_CODE });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setReading({ id: Date.now(), code: '', hint: `Reading failed (${detail}). Type the code instead.` });
    } finally {
      setBusy(false);
    }
  }

  if (cameraError) {
    return (
      <div className="stack">
        <p className="pad error">{cameraError}</p>
        <ResultPanel
          key={manualId}
          db={db}
          initialCode=""
          hint="You can still add cards by typing their set code."
          onAdd={(entry) => {
            onAdd(entry);
            setManualId((id) => id + 1);
          }}
          onClose={null}
        />
      </div>
    );
  }

  return (
    <div className="scan">
      <CameraView busy={busy} onCapture={handleCapture} onError={setCameraError} />
      {reading && (
        <ResultPanel
          key={reading.id}
          db={db}
          initialCode={reading.code}
          hint={reading.hint}
          onAdd={(entry) => {
            onAdd(entry);
            setReading(null);
          }}
          onClose={() => setReading(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Edit `src/App.tsx`**

Edit 1 — add one import below the `cardDatabase` import:

```tsx
import { createCollection, type Entry, type NewEntry } from './collection';
```

Edit 2 — below `const db = createCardDatabase(SOURCES, indexedDB);` add:

```tsx
const collection = createCollection(localStorage);
```

Edit 3 — inside `App`, below the `const refresh = …` line, add:

```tsx
  const [entries, setEntries] = useState<Entry[]>(collection.all());

  function showSaved(saved: boolean, message: string) {
    setEntries(collection.all());
    setNotice(saved ? message : 'Changed, but the list could not be saved on this phone. Export it to keep a copy.');
  }

  function handleAdd(entry: NewEntry) {
    showSaved(collection.add(entry), `Added ${entry.name}`);
  }
```

Edit 4 — replace the line

```tsx
        {ready && tab === 'scan' && <ScanScreen />}
```

with

```tsx
        {ready && tab === 'scan' && (
          <ScanScreen db={db} onAdd={handleAdd} onOpenSettings={() => setTab('settings')} />
        )}
```

`entries` is not rendered until Task 13. To keep `noUnusedLocals` satisfied in this task, also change the top bar line to show the count:

```tsx
      <header className="topbar">YGO Scanner · {entries.reduce((sum, entry) => sum + entry.quantity, 0)} cards</header>
```

- [ ] **Step 4: Append to `src/styles.css`**

```css
.result { border-top: 1px solid var(--line); background: var(--panel); max-height: 60%; overflow-y: auto; }
.row.wrap { flex-wrap: wrap; }
label.stack { gap: 4px; }
```

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: all tests pass.

Run: `npm run build`
Expected: passes.

Run: `npm run dev` and check in a desktop browser (with no webcam the manual-entry path appears, which is enough to test the panel):
- With no subscription: the Scan tab shows the "subscribe first" message and its button opens Settings. Subscribe.
- Type `lob-en001`: the field shows `LOB-EN001`, the card name "Blue-Eyes White Dragon" appears, Language is English, Add is enabled.
- Type `LOB-FR001`: same card, Language is French.
- Type `LOB-EN00X`: "Card not found" with tappable suggestions; tapping one fills the field and finds the card.
- Type `RA01-EN010` (or any code that shows a rarity selector): Add stays disabled until a rarity is chosen.
- Type `LOB-ZZ001`: the card is found, Language shows "Unknown — choose one", Add stays disabled until a language is chosen.
- Press Add: a notice "Added …" appears and the top bar count goes up; adding the same card again raises the count again.

Stop the dev server afterwards.

- [ ] **Step 6: Commit and deploy**

```bash
git add -A
git commit -m "Add result panel and full scan flow" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Milestone 2 is complete. With the user's go-ahead, push to `main` so they can try scanning with real identification on their phone.

---

# Milestone 3 — List, export, install

### Task 12: CSV export and import

**Files:**
- Create: `src/csv.ts`
- Test: `src/csv.test.ts`

**Interfaces:**
- Consumes: `Entry`, `isEntry`, `entryKey` (Task 9).
- Produces, from `src/csv.ts`:
  - `toCsv(entries: Entry[]): string` — comma-separated, CRLF line ends, header `code,matched_code,language,name,set_name,rarity,quantity,added_at`.
  - `fromCsv(text: string): { entries: Entry[]; skipped: number }` — throws `Error` with a user-readable message when the header is wrong. Rows with the same code, language, and rarity are combined.

- [ ] **Step 1: Write the failing tests**

`src/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Entry } from './collection';
import { fromCsv, toCsv } from './csv';

const HEADER = 'code,matched_code,language,name,set_name,rarity,quantity,added_at';

const BEWD: Entry = {
  code: 'LOB-FR001',
  matchedCode: 'LOB-EN001',
  language: 'French',
  name: 'Blue-Eyes White Dragon',
  setName: 'Legend of Blue Eyes White Dragon',
  rarity: 'Ultra Rare',
  quantity: 2,
  addedAt: '2026-10-09T12:00:00.000Z',
};

const TRICKY: Entry = {
  code: 'MP19-EN001',
  matchedCode: 'MP19-EN001',
  language: 'English',
  name: 'Ib the World Chalice "Justiciar", Reborn',
  setName: 'Line one\nLine two; with semicolon',
  rarity: 'Common',
  quantity: 1,
  addedAt: '2026-10-09T12:00:01.000Z',
};

describe('toCsv', () => {
  it('writes a header and one line per entry', () => {
    expect(toCsv([BEWD])).toBe(
      `${HEADER}\r\nLOB-FR001,LOB-EN001,French,Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,Ultra Rare,2,2026-10-09T12:00:00.000Z\r\n`,
    );
  });

  it('writes only the header for an empty list', () => {
    expect(toCsv([])).toBe(`${HEADER}\r\n`);
  });

  it('quotes fields containing commas, quotes, semicolons or newlines', () => {
    const csv = toCsv([TRICKY]);
    expect(csv).toContain('"Ib the World Chalice ""Justiciar"", Reborn"');
    expect(csv).toContain('"Line one\nLine two; with semicolon"');
  });
});

describe('fromCsv', () => {
  it('round-trips entries, including tricky text', () => {
    expect(fromCsv(toCsv([BEWD, TRICKY]))).toEqual({ entries: [BEWD, TRICKY], skipped: 0 });
  });

  it('reads an empty list', () => {
    expect(fromCsv(toCsv([]))).toEqual({ entries: [], skipped: 0 });
  });

  it('reads a file re-saved by Excel: byte-order mark, CRLF, semicolons', () => {
    const excel =
      '﻿code;matched_code;language;name;set_name;rarity;quantity;added_at\r\n' +
      'LOB-FR001;LOB-EN001;French;Blue-Eyes White Dragon;Legend of Blue Eyes White Dragon;Ultra Rare;2;2026-10-09T12:00:00.000Z\r\n';
    expect(fromCsv(excel)).toEqual({ entries: [BEWD], skipped: 0 });
  });

  it('reads LF line ends and a file without a final newline', () => {
    const text = `${HEADER}\nLOB-FR001,LOB-EN001,French,Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,Ultra Rare,2,2026-10-09T12:00:00.000Z`;
    expect(fromCsv(text).entries).toEqual([BEWD]);
  });

  it('ignores blank lines and tolerates header case and spaces', () => {
    const text = `Code, Matched_Code, Language, Name, Set_Name, Rarity, Quantity, Added_At\r\n\r\nLOB-FR001,LOB-EN001,French,Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,Ultra Rare,2,2026-10-09T12:00:00.000Z\r\n\r\n`;
    expect(fromCsv(text)).toEqual({ entries: [BEWD], skipped: 0 });
  });

  it('skips malformed rows and counts them', () => {
    const rows = [
      HEADER,
      'LOB-FR001,LOB-EN001,French,Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,Ultra Rare,2,2026-10-09T12:00:00.000Z',
      'too,few,fields',
      'LOB-FR001,LOB-EN001,French,Name,Set,Ultra Rare,zero,2026-10-09T12:00:00.000Z',
      'LOB-FR001,LOB-EN001,French,Name,Set,Ultra Rare,0,2026-10-09T12:00:00.000Z',
      'LOB-FR001,LOB-EN001,French,Name,Set,Ultra Rare,1.5,2026-10-09T12:00:00.000Z',
      'LOB-FR001,LOB-EN001,Klingon,Name,Set,Ultra Rare,1,2026-10-09T12:00:00.000Z',
      'not a code,LOB-EN001,French,Name,Set,Ultra Rare,1,2026-10-09T12:00:00.000Z',
    ];
    expect(fromCsv(rows.join('\r\n'))).toEqual({ entries: [BEWD], skipped: 6 });
  });

  it('combines repeated rows for the same card', () => {
    const line = 'LOB-FR001,LOB-EN001,French,Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,Ultra Rare,2,2026-10-09T12:00:00.000Z';
    expect(fromCsv([HEADER, line, line].join('\r\n')).entries).toEqual([{ ...BEWD, quantity: 4 }]);
  });

  it('rejects a file with the wrong header', () => {
    expect(() => fromCsv('name,price\r\nA,1\r\n')).toThrow(/not a YGO Scanner card list/i);
    expect(() => fromCsv('')).toThrow(/not a YGO Scanner card list/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/csv.test.ts`
Expected: FAIL — cannot resolve `./csv`.

- [ ] **Step 3: Write the implementation**

`src/csv.ts`:

```ts
import { entryKey, isEntry, type Entry } from './collection';

const HEADER = ['code', 'matched_code', 'language', 'name', 'set_name', 'rarity', 'quantity', 'added_at'];

function quote(value: string): string {
  return /[",;\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(entries: Entry[]): string {
  const lines = [HEADER.join(',')];
  for (const e of entries) {
    lines.push(
      [e.code, e.matchedCode, e.language, e.name, e.setName, e.rarity, String(e.quantity), e.addedAt]
        .map(quote)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function fromCsv(text: string): { entries: Entry[]; skipped: number } {
  const body = text.replace(/^﻿/, '');
  const firstLine = body.split('\n', 1)[0];
  // Excel on systems with a decimal comma saves "CSV" with semicolons.
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';

  const rows = parseRows(body, delimiter);
  const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase());
  if (header.length !== HEADER.length || header.some((cell, i) => cell !== HEADER[i])) {
    throw new Error('This file is not a YGO Scanner card list.');
  }

  const byKey = new Map<string, Entry>();
  let skipped = 0;
  for (const row of rows.slice(1)) {
    if (row.length === 1 && row[0].trim() === '') continue;
    const candidate: unknown =
      row.length === HEADER.length
        ? {
            code: row[0].trim(),
            matchedCode: row[1].trim(),
            language: row[2].trim(),
            name: row[3],
            setName: row[4],
            rarity: row[5],
            quantity: Number(row[6]),
            addedAt: row[7].trim(),
          }
        : null;
    if (!isEntry(candidate)) {
      skipped++;
      continue;
    }
    const key = entryKey(candidate);
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, quantity: existing.quantity + candidate.quantity } : candidate);
  }
  return { entries: [...byKey.values()], skipped };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add CSV export and import" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: My cards screen with export and import

**Files:**
- Create: `src/saveFile.ts`, `src/ui/CardsScreen.tsx`
- Modify: `src/App.tsx` (five edits), `src/styles.css` (append)

**Interfaces:**
- Consumes: `Entry`, `entryKey`, `Collection` methods (Task 9); `toCsv`, `fromCsv` (Task 12); `App`'s `collection`, `entries`, `showSaved`, `setTab` (Tasks 10–11).
- Produces:
  - `saveTextFile(name: string, text: string, type: string): Promise<void>` from `src/saveFile.ts` — opens the share sheet when the device can share files, otherwise downloads.
  - `CardsScreen` with props:
    ```ts
    {
      entries: Entry[];
      onSetQuantity: (key: string, quantity: number) => void;
      onRemove: (key: string) => void;
      onImport: (entries: Entry[], mode: 'merge' | 'replace') => void;
      onGoScan: () => void;
    }
    ```

- [ ] **Step 1: Write `saveFile`**

`src/saveFile.ts`:

```ts
// Installed web apps on iOS handle blob downloads poorly, so prefer the share
// sheet ("Save to Files", AirDrop, mail) and fall back to a normal download.
export async function saveTextFile(name: string, text: string, type: string): Promise<void> {
  const file = new File([text], name, { type });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return; // the user closed the sheet
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 2: Write `CardsScreen`**

`src/ui/CardsScreen.tsx`:

```tsx
import { useRef, useState } from 'react';
import { entryKey, type Entry } from '../collection';
import { fromCsv, toCsv } from '../csv';
import { saveTextFile } from '../saveFile';

type Props = {
  entries: Entry[];
  onSetQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onImport: (entries: Entry[], mode: 'merge' | 'replace') => void;
  onGoScan: () => void;
};

type Pending = { entries: Entry[]; skipped: number };

export function CardsScreen({ entries, onSetQuantity, onRemove, onImport, onGoScan }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function confirmRemove(entry: Entry) {
    if (window.confirm(`Remove “${entry.name}” (${entry.code}) from your list?`)) onRemove(entryKey(entry));
  }

  function decrease(entry: Entry) {
    if (entry.quantity > 1) onSetQuantity(entryKey(entry), entry.quantity - 1);
    else confirmRemove(entry);
  }

  async function exportCsv() {
    const date = new Date().toISOString().slice(0, 10);
    await saveTextFile(`ygo-cards-${date}.csv`, toCsv(entries), 'text/csv');
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    setPending(null);
    try {
      setPending(fromCsv(await file.text()));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function finishImport(mode: 'merge' | 'replace') {
    if (!pending) return;
    onImport(pending.entries, mode);
    setPending(null);
  }

  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);

  return (
    <div className="pad stack">
      <div className="row">
        <h2 className="grow">
          My cards <span className="muted">· {total}</span>
        </h2>
        <button disabled={entries.length === 0} onClick={() => void exportCsv()}>
          Export CSV
        </button>
        <button onClick={() => fileInput.current?.click()}>Import CSV</button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(event) => void readFile(event.target.files?.[0])}
        />
      </div>

      {importError && <div className="error">{importError}</div>}

      {pending && (
        <section className="card stack">
          <div>
            The file contains {pending.entries.length} card{pending.entries.length === 1 ? '' : 's'}.
            {pending.skipped > 0 && ` ${pending.skipped} unreadable row${pending.skipped === 1 ? ' was' : 's were'} skipped.`}
          </div>
          <div className="row wrap">
            <button className="primary" disabled={pending.entries.length === 0} onClick={() => finishImport('merge')}>
              Merge into my list
            </button>
            <button
              className="danger"
              disabled={pending.entries.length === 0}
              onClick={() => finishImport('replace')}
            >
              Replace my list
            </button>
            <button onClick={() => setPending(null)}>Cancel</button>
          </div>
        </section>
      )}

      {entries.length === 0 && (
        <div className="stack">
          <p className="muted">No cards yet. Scan a card to add it here.</p>
          <button className="primary" onClick={onGoScan}>
            Scan a card
          </button>
        </div>
      )}

      {entries.map((entry) => (
        <section className="card" key={entryKey(entry)}>
          <div className="row">
            <div className="grow">
              <strong>{entry.name}</strong>
              <div className="muted">
                {entry.code} · {entry.language} · {entry.rarity}
              </div>
              <div className="muted">{entry.setName}</div>
            </div>
            <div className="quantity">
              <button aria-label="One fewer" onClick={() => decrease(entry)}>
                −
              </button>
              <span>{entry.quantity}</span>
              <button aria-label="One more" onClick={() => onSetQuantity(entryKey(entry), entry.quantity + 1)}>
                +
              </button>
            </div>
            <button className="danger" aria-label="Remove" onClick={() => confirmRemove(entry)}>
              ✕
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Edit `src/App.tsx`**

Edit 1 — add the import:

```tsx
import { CardsScreen } from './ui/CardsScreen';
```

Edit 2 — replace the `Tab` type and `TABS` constant with:

```tsx
type Tab = 'scan' | 'cards' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'scan', label: 'Scan' },
  { id: 'cards', label: 'My cards' },
  { id: 'settings', label: 'Settings' },
];
```

Edit 3 — inside `App`, below `handleAdd`, add:

```tsx
  function handleImport(imported: Entry[], mode: 'merge' | 'replace') {
    const saved = mode === 'merge' ? collection.merge(imported) : collection.replaceAll(imported);
    showSaved(saved, `Imported ${imported.length} card${imported.length === 1 ? '' : 's'}`);
  }

  function handleChange(saved: boolean) {
    setEntries(collection.all());
    if (!saved) setNotice('Changed, but the list could not be saved on this phone. Export it to keep a copy.');
  }
```

Edit 4 — below the `{ready && tab === 'scan' && (…)}` block, add:

```tsx
        {ready && tab === 'cards' && (
          <CardsScreen
            entries={entries}
            onSetQuantity={(key, quantity) => handleChange(collection.setQuantity(key, quantity))}
            onRemove={(key) => handleChange(collection.remove(key))}
            onImport={handleImport}
            onGoScan={() => setTab('scan')}
          />
        )}
```

Edit 5 — restore the plain top bar (the count now lives on the My cards screen):

```tsx
      <header className="topbar">YGO Scanner</header>
```

- [ ] **Step 4: Append to `src/styles.css`**

```css
.quantity { display: flex; align-items: center; gap: 6px; }
.quantity button { padding: 6px 12px; }
.quantity span { min-width: 1.5em; text-align: center; }
```

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: all tests pass.

Run: `npm run build`
Expected: passes.

Run: `npm run dev` and check in a desktop browser:
- My cards with an empty list shows the empty message; its button opens Scan.
- Add two different cards and the same card twice from the Scan tab; My cards lists them with correct quantities and the total.
- `+` and `−` change the quantity; `−` at 1 asks before removing; `✕` asks before removing.
- Reload: the list is still there.
- Export CSV produces a file (or the share sheet). Open it: header plus one line per card.
- Import that file → "Merge into my list" doubles the quantities; import again → "Replace my list" restores the file's quantities.
- Import an unrelated text file: "This file is not a YGO Scanner card list." and the list is unchanged.

Stop the dev server afterwards.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add My cards screen with CSV export and import" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Installable, offline-capable app

**Files:**
- Create: `scripts/make-icons.mjs`, `public/icon-180.png`, `public/icon-192.png`, `public/icon-512.png` (generated)
- Modify: `vite.config.ts` (replace whole file), `index.html` (add three tags), `package.json` (add one script)

**Interfaces:**
- Consumes: the built app.
- Produces: a web app manifest, a service worker that precaches the app shell and caches Tesseract.js files from `cdn.jsdelivr.net` on first use, and home-screen icons.

- [ ] **Step 1: Write the icon generator**

`scripts/make-icons.mjs`:

```js
// Generates the app icons as PNG files with no dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function png(size, colourAt) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = colourAt((x + 0.5) / size, (y + 0.5) / size);
      raw.set([r, g, b], y * stride + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BACKGROUND = [0x11, 0x14, 0x18];
const CARD = [0xc9, 0xa2, 0x5a];
const inside = (x, y, left, top, right, bottom) => x >= left && x < right && y >= top && y < bottom;

// A card outline with an art box and, under it on the right, the set-code strip.
// Kept inside the central 60% so it survives maskable-icon cropping.
function icon(x, y) {
  if (!inside(x, y, 0.3, 0.2, 0.7, 0.8)) return BACKGROUND;
  if (inside(x, y, 0.35, 0.28, 0.65, 0.52)) return BACKGROUND;
  if (inside(x, y, 0.5, 0.56, 0.65, 0.6)) return BACKGROUND;
  return CARD;
}

mkdirSync('public', { recursive: true });
for (const size of [180, 192, 512]) {
  writeFileSync(`public/icon-${size}.png`, png(size, icon));
  console.log(`public/icon-${size}.png`);
}
```

Add to `package.json` `"scripts"`:

```json
    "icons": "node scripts/make-icons.mjs"
```

- [ ] **Step 2: Generate the icons**

Run: `npm run icons`
Expected: prints the three file paths. Open `public/icon-512.png` and confirm it shows a gold card shape on a dark background.

- [ ] **Step 3: Replace `vite.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-180.png'],
      manifest: {
        name: 'YGO Scanner',
        short_name: 'YGO Scanner',
        description: 'Scan Yu-Gi-Oh card set codes and keep a list of your cards.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#111418',
        theme_color: '#111418',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,wasm}'],
        runtimeCaching: [
          {
            // Tesseract.js worker, core, and English model, fetched on first scan.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@tesseract\.js-data|tesseract\.js)/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 20 },
            },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node' },
});
```

- [ ] **Step 4: Add iOS tags to `index.html`**

Inside `<head>`, below the `theme-color` meta tag, add:

```html
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="apple-touch-icon" href="./icon-180.png" />
```

- [ ] **Step 5: Verify locally**

Run: `npm test`
Expected: all tests pass.

Run: `npm run build`
Expected: passes, and `dist/` contains `manifest.webmanifest`, `sw.js`, and the three icons.

Run: `npm run preview`, open the printed URL in desktop Chrome, open dev tools → Application.
Expected:
- **Manifest** shows the name "YGO Scanner" and the icons with no errors.
- **Service workers** shows `sw.js` activated.
- Subscribe to the database, then scan or type a code once so the recognition files are fetched. If the browser has no webcam, skip the scan; the recognition files are then checked on the phone in Step 7.
- Tick **Offline** in the Network tab and reload: the app loads, My cards shows the list, and typing a code on the Scan tab still finds the card.

Stop the preview server afterwards.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Make the app installable and usable offline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Deploy and test on real phones (user)**

With the user's go-ahead, push to `main` and wait for the Deploy workflow to finish. Then ask the user to check, on one iPhone (Safari) and one Android phone (Chrome):

1. Open the site, then **Share → Add to Home Screen** (iPhone) or **Install app** (Android). The icon appears and the app opens full screen.
2. Settings → Subscribe. The database downloads.
3. Scan several cards, including a non-English one: each is identified with the right language, and a card with several rarities asks for the rarity.
4. Close and reopen the app: the list is still there, and Settings shows a fresh "Last checked" time.
5. Turn on airplane mode and reopen: the app opens, the list shows, and scanning still identifies cards.
6. Export CSV: the share sheet or a download appears and the file can be saved.

If airplane-mode scanning fails with "Reading failed", the recognition files were not cached: in the phone's browser dev tools or `dist/sw.js`, compare the URLs Tesseract.js requests with the `urlPattern` in `vite.config.ts` and widen the pattern to cover them.

Report the results to the user. The plan is complete when all six checks pass on both phones.
