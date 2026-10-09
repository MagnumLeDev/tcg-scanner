# Yu-Gi-Oh Card Scanner — Design

Date: 2026-10-09 (revised the same day: Cardmarket deferred, offline card database added, card language made explicit)

## Purpose

A phone app for Maxime and a few friends, on iPhone and Android, that:

1. Reads the set code printed under a Yu-Gi-Oh card's artwork (e.g. `LOB-FR001`) with the camera.
2. Identifies the card from that code, using a card database downloaded onto the phone.
3. Keeps a list of the cards scanned on that phone, including each card's **language**, because language affects price.

It will never be published on an app store. Success for this version means a friend can open a link, install the app to their home screen, download the card database once, and then scan a card in a few seconds and see it correctly identified with the right language.

A later version will add a button per card that opens its Cardmarket page. This version stores everything that link will need (card name, set name, rarity, language) but builds no link.

## Approach

A Progressive Web App (PWA): a website that is installed with "Add to Home Screen" and runs full screen with camera access. This was chosen over a native app because it reaches iPhones without a paid Apple Developer account or per-device registration, and one codebase serves both platforms.

Text recognition runs in the browser. This is less accurate than native recognition, so the design constrains the problem: a small aiming frame, a restricted character set, pattern validation, matching against the list of codes that actually exist, and manual correction.

## Scope

In scope:

- Download and update of the card database on the phone
- Scan screen with camera, aiming frame, capture, and confirm/correct step
- Card identification by set code, offline
- Language detected from the code and stored with the card
- Card list with quantity and delete
- CSV export and import
- Installable, usable offline once the database is downloaded

Out of scope:

- Cardmarket links and prices (next version)
- Accounts, sync, or shared lists
- Continuous (hands-free) scanning
- Interface languages other than English
- Recognising a card from its artwork or name

## Stack

| Part | Choice |
|---|---|
| Framework | React + TypeScript, built with Vite |
| Text recognition | Tesseract.js (English model) |
| Card database storage | IndexedDB |
| Card list storage | `localStorage` |
| PWA | `vite-plugin-pwa` (manifest + service worker) |
| Tests | Vitest |
| Hosting | GitHub Pages, deployed by a GitHub Actions workflow |
| Location | `~/projects/ygo-scanner` |

## Card database

Source: YGOPRODeck, free and usable directly from a browser (it sends `Access-Control-Allow-Origin: *`).

- `GET https://db.ygoprodeck.com/api/v7/cardinfo.php` returns every card with its printings. Measured on 2026-10-09: about 2.9 MB over the network (compressed), 21 MB as JSON, 14,599 cards, 44,659 printings, 38,541 distinct set codes.
- `GET https://db.ygoprodeck.com/api/v7/checkDBVer.php` returns the database version and last update date.

Three facts about this data shape the design:

1. **It is too big for `localStorage`.** The app reduces it to one compact record per printing (about 3.4 MB) and stores that in IndexedDB.
2. **Codes are indexed in English only.** Nearly all codes use region `EN` (the rest are regionless, `E`, or `PT`). A French card printed `LOB-FR001` is found under `LOB-EN001`. The app therefore matches on the English form but records the printed code and language.
3. **One code can have several rarities.** 44,659 printings share 38,541 codes, because a card can exist in one set as, say, both Ultra Rare and Secret Rare under the same code. When that happens the user picks the rarity.

A handful of malformed codes in the source (13, e.g. `DB49`, `MF03-EN0??`) do not match the set-code pattern and are skipped on import.

## Screens

### Scan

- If no card database is on the phone, the screen shows a "Download card database" prompt instead of the camera.
- Live rear-camera preview (`getUserMedia` with `facingMode: "environment"`, video element with `playsinline` for iOS).
- A fixed rectangular frame overlaid on the preview, wide and short, sized for one line of text.
- A capture button. On tap, the app grabs the current frame, runs recognition, and shows a result panel.
- Result panel:
  - Editable text field holding the recognised code. Editing re-runs the match.
  - Match result: card name and set name, or "not found" with up to 5 tappable near-miss suggestions.
  - **Language** selector, pre-filled from the code, changeable by the user.
  - **Rarity** selector, shown only when the code has more than one rarity.
  - "Add" button (enabled only when a card is matched and a rarity is set) and "Retry" button.

### My cards

- One row per distinct combination of printed code and rarity: card name, code as printed, language, set name, rarity, quantity.
- Per row: quantity − / +, delete. Quantity − at 1 asks before deleting.
- Export CSV and Import CSV buttons.
- Empty state pointing to the Scan screen.

### Settings

- Card database status: version, date downloaded, number of printings.
- "Download card database" / "Update card database" button with a progress indicator. Pressing it checks `checkDBVer.php`; if the version on the phone is current it says so and does nothing.

Navigation is a three-tab bottom bar: Scan, My cards, Settings.

## Modules

Each module has one job and a small interface. Everything except `camera` and `ocr` is unit-tested.

### `camera`

Starts and stops the camera stream and returns the pixels inside the aiming frame as a canvas. Depends on browser media APIs only.

### `ocr`

`recognise(canvas) → string`. Preprocesses the crop (greyscale, contrast stretch, 2–3× upscale), then runs Tesseract.js with:

- character whitelist `A–Z`, `0–9`, `-`
- single-line page segmentation mode

Tesseract.js and its model are loaded lazily on first visit to the Scan screen and cached by the service worker.

### `setCode`

Pure functions on strings.

- `extract(text) → string | null`: uppercases, strips spaces, normalises dash variants to `-`, and returns the first match of `[A-Z0-9]{2,5}-[A-Z]{0,2}[A-Z0-9]{3}`.
- `parse(code) → { prefix, region, number }`: `number` is the last 3 characters; `region` is the 0–2 letters between the hyphen and `number`. So `LOB-FR001` → `LOB / FR / 001`, `SDY-046` → `SDY / "" / 046`, `DUEA-ENSE1` → `DUEA / EN / SE1`.
- `language(region) → Language`: see the table below.
- `lookupCandidates(code) → string[]`: the ordered list of codes to try against the database:
  1. the code as read
  2. the code with misread fixes in `number` (`O→0`, `I→1`, `L→1`), if that differs
  3. each of the above with `region` replaced by `EN`
  4. each of the above with `region` replaced by `E`
  5. each of the above with `region` removed

  Duplicates are removed.

Language from region:

| Region | Language |
|---|---|
| `EN`, `E`, none | English |
| `FR`, `F` | French |
| `DE`, `G` | German |
| `IT`, `I` | Italian |
| `SP`, `S` | Spanish |
| `PT`, `P` | Portuguese |
| `JP` | Japanese |
| `KR`, `K` | Korean |
| `AE` | Asian English |
| `TC` | Traditional Chinese |
| `SC` | Simplified Chinese |
| anything else | Unknown (user picks) |

### `cardDatabase`

Owns the downloaded card data.

```ts
type Printing = {
  code: string;    // as indexed by the source, e.g. "LOB-EN001"
  name: string;
  setName: string;
  rarity: string;
};
```

- `status() → { version, downloadedAt, count } | null`
- `download(onProgress)`: fetches `cardinfo.php`, flattens it to `Printing[]`, skips codes that fail the set-code pattern, and replaces the IndexedDB contents in a single transaction, so a failed download leaves the previous database intact.
- `isUpToDate() → boolean`: compares the stored version with `checkDBVer.php`.
- `find(code) → Printing[]`: all printings for an exact code (one per rarity).
- `suggest(code) → string[]`: up to 5 known codes within edit distance 1 of the given code, for the near-miss suggestions.

On app start the printings are loaded into an in-memory map keyed by code, so matching is instant.

### `cardMatch`

`match(code) → { printings: Printing[], matchedCode: string } | null`. Tries each candidate from `setCode.lookupCandidates` against `cardDatabase.find` and returns the first hit. Works offline.

### `collection`

Owns the list and its persistence.

```ts
type Entry = {
  code: string;        // as printed, e.g. "LOB-FR001"
  matchedCode: string; // code matched in the database, e.g. "LOB-EN001"
  language: Language;
  name: string;
  setName: string;
  rarity: string;
  quantity: number;
  addedAt: string;     // ISO timestamp
};
```

An entry is identified by `code` + `language` + `rarity`. Operations: `add(entry)` (increments quantity if the entry exists), `setQuantity`, `remove`, `all`, `replaceAll`. State is stored as JSON under the `localStorage` key `ygo-scanner.collection.v1`. Corrupt or missing data loads as an empty list.

### `csv`

- `toCsv(entries) → string` with header `code,matched_code,language,name,set_name,rarity,quantity,added_at`, quoting fields that contain commas, quotes, or newlines.
- `fromCsv(text) → Entry[]`, rejecting files with a wrong header and skipping malformed rows, reporting how many were skipped.

Import asks whether to **merge** (add quantities for matching entries) or **replace** the current list.

## Error handling

| Situation | Behaviour |
|---|---|
| No card database on the phone | Scan screen shows the download prompt instead of the camera |
| Database download fails or is interrupted | Error message with Retry; any previous database is kept |
| Camera permission denied or unavailable | Message explaining how to allow the camera, plus a manual code entry field so the app remains usable |
| No text matching the pattern | "No code found — move closer and retry", field left editable |
| Code not in database | "Card not found" with near-miss suggestions, field left editable, Add disabled |
| Unknown region in the code | Language selector starts on "Unknown"; Add stays disabled until a language is chosen |
| Storage write fails (quota) | Error message; the in-memory list is kept so export still works |
| Invalid CSV on import | Error message; current list untouched |

## Offline behaviour

The service worker caches the app shell and the recognition model. Once the card database is downloaded, scanning, matching, and the list all work with no connection. Only downloading or updating the database needs the network.

## Testing

- **Unit (Vitest):**
  - `setCode`: extraction, parsing, language mapping, candidates, across English, French, regionless, old European, and special-edition codes.
  - `cardDatabase`: flattening a sample of the real API response, skipping malformed codes, `find` with multiple rarities, `suggest`, failed download keeping the old data (IndexedDB faked with `fake-indexeddb`, `fetch` mocked).
  - `cardMatch`: candidate order, French code resolving to the English entry.
  - `collection`: add/merge/quantity/remove, same code with different language or rarity kept as separate entries, corrupt storage.
  - `csv`: round trip, quoting, bad input.
- **Manual on real phones:** camera, recognition accuracy, database download, install to home screen, on one iPhone (Safari) and one Android phone (Chrome).

## Milestones

1. **Scan proof.** Project scaffold, `camera`, `ocr`, `setCode`, and a bare Scan screen that shows the recognised code and detected language. Deployed to GitHub Pages and tried on a real phone with real cards. If recognition is unusable, stop and revisit the approach before building further.
2. **Database and matching.** `cardDatabase`, `cardMatch`, the Settings screen, and the full result panel with language and rarity selectors.
3. **List, export, install.** `collection`, the My cards screen, `csv`, the PWA manifest, service worker, and icons.

## Requirements on the user

- A GitHub account and a repository for hosting on GitHub Pages.
- A phone and a few cards, ideally in more than one language, for the milestone 1 test.
