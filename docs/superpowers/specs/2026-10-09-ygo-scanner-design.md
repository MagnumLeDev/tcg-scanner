# Yu-Gi-Oh Card Scanner — Design

Date: 2026-10-09 (revised the same day: Cardmarket deferred, card database subscriptions added, card language made explicit)

## Purpose

A phone app for Maxime and a few friends, on iPhone and Android, that:

1. Reads the set code printed under a Yu-Gi-Oh card's artwork (e.g. `LOB-FR001`) with the camera.
2. Identifies the card from that code, using card databases the user has subscribed to, which are stored on the phone and kept up to date automatically.
3. Keeps a list of the cards scanned on that phone, including each card's **language**, because language affects price.

It will never be published on an app store. Success for this version means a friend can open a link, install the app to their home screen, subscribe to the card database once, and then scan a card in a few seconds and see it correctly identified with the right language.

A later version will add a button per card that opens its Cardmarket page. This version stores everything that link will need (card name, set name, rarity, language) but builds no link.

## Approach

A Progressive Web App (PWA): a website that is installed with "Add to Home Screen" and runs full screen with camera access. This was chosen over a native app because it reaches iPhones without a paid Apple Developer account or per-device registration, and one codebase serves both platforms.

Text recognition runs in the browser. This is less accurate than native recognition, so the design constrains the problem: a small aiming frame, a restricted character set, pattern validation, matching against the list of codes that actually exist, and manual correction.

## Scope

In scope:

- Subscribing to card databases, automatic update check each time the app opens, and a force refresh button
- Scan screen with a full-screen camera and card outline, automatic detection, and a confirm/correct step
- Card identification by set code, offline
- Language detected from the code and stored with the card
- Card list with quantity and delete
- CSV export and import
- Installable, usable offline once a database is downloaded

Out of scope:

- Cardmarket links and prices (next version)
- Accounts, sync, or shared lists
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

## Card databases

The app has a built-in list of available card databases. The user subscribes to the ones they want; only subscribed databases are downloaded and used for matching. This version ships with one available database, YGOPRODeck. Others can be added later by writing a new source definition, with no change to the rest of the app.

### Subscription behaviour

- **Subscribe:** downloads the database immediately and marks it subscribed.
- **Every time the app opens:** for each subscribed database, if the phone is online, the app asks the source for its current version. If it differs from the version on the phone, the new data is downloaded in the background and swapped in when complete. This never blocks the app: scanning keeps working on the existing data, and a short notice reports the result ("Card database updated — 42 new printings"). If the phone is offline or the check fails, the app stays silent and uses what it has.
- **Force refresh:** re-downloads the database regardless of version, for when the data looks wrong or incomplete.
- **Unsubscribe:** asks for confirmation, then deletes that database's data from the phone. Cards already in the user's list are untouched, since the list stores its own copy of each card's details.

### YGOPRODeck

Free and usable directly from a browser (it sends `Access-Control-Allow-Origin: *`).

- `GET https://db.ygoprodeck.com/api/v7/cardinfo.php` returns every card with its printings. Measured on 2026-10-09: about 2.9 MB over the network (compressed), 21 MB as JSON, 14,599 cards, 44,659 printings, 38,541 distinct set codes.
- `GET https://db.ygoprodeck.com/api/v7/checkDBVer.php` returns the database version and last update date.

Three facts about this data shape the design:

1. **It is too big for `localStorage`.** The app reduces it to one compact record per printing (about 3.4 MB) and stores that in IndexedDB.
2. **Codes are indexed in English only.** Nearly all codes use region `EN` (the rest are regionless, `E`, or `PT`). A French card printed `LOB-FR001` is found under `LOB-EN001`. The app therefore matches on the English form but records the printed code and language.
3. **One code can have several rarities.** 44,659 printings share 38,541 codes, because a card can exist in one set as, say, both Ultra Rare and Secret Rare under the same code. When that happens the user picks the rarity.

A handful of malformed codes in the source (13, e.g. `DB49`, `MF03-EN0??`) do not match the set-code pattern and are skipped on import.

## Screens

### Scan

- If the user has no subscribed database with data on the phone, the screen shows a prompt leading to Settings instead of the camera.
- Live rear-camera preview (`getUserMedia` with `facingMode: "environment"`, video element with `playsinline` for iOS).
- The preview fills the screen, with a card-shaped outline (59 × 86 proportions). The user holds the card roughly inside it; they do not aim at the code.
- No capture button. The app reads continuously the band of the outline where the set code is printed (under the artwork, on the right, with generous margins).
- A card is detected when a code read from the band matches a card in a subscribed database and is read twice within three readings. Letters in the number that look like digits (O, I, S, B…) are put right before matching. The result panel then opens and reading pauses; on Android the phone vibrates.
- After the panel is closed, the same code is ignored until the card has left the view.
- "Type the code" opens the result panel empty, for cards that will not read. "Details" shows what the text reader was given and what it read.
- Result panel:
  - Editable text field holding the recognised code. Editing re-runs the match.
  - Match result: card name and set name, or "not found" with up to 5 tappable near-miss suggestions.
  - **Language** selector, pre-filled from the code, changeable by the user.
  - **Rarity** selector, shown only when the code has more than one rarity.
  - "Add" button (enabled only when a card is matched and a rarity is set) and "Dismiss" button.

### My cards

- One row per distinct combination of printed code and rarity: card name, code as printed, language, set name, rarity, quantity.
- Per row: quantity − / +, delete. Quantity − at 1 asks before deleting.
- Export CSV and Import CSV buttons.
- Empty state pointing to the Scan screen.

### Settings

A "Card databases" list with one row per available database, showing:

- Name and a Subscribe / Unsubscribe button.
- For a subscribed database: version, date last updated, date last checked, number of printings.
- A "Force refresh" button with a progress indicator.
- The error from the last failed download, if any.

Navigation is a three-tab bottom bar: Scan, My cards, Settings.

## Modules

Each module has one job and a small interface. Everything except `camera` and `ocr` is unit-tested.

### `camera`

Starts and stops the camera stream and returns the pixels inside the aiming frame as a canvas. Depends on browser media APIs only.

### `ocr`

`recognise(canvas) → string`. Enlarges the crop 2×, turns it into black ink on white by comparing each pixel with its neighbourhood (once for dark text, once for light text), erases ink too large or too small to be a code character, then runs Tesseract.js once on both versions stacked, with:

- character whitelist `A–Z`, `0–9`, `-`
- sparse-text page segmentation mode

### `detector`

`createDetector(find)` turns the stream of readings into detections: `feed(text)` returns a card once its code is confirmed, `dismiss(code)` sets a code aside until its card has left the view.

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

### `sources`

The built-in list of available databases. Each source is a small object:

```ts
type Printing = {
  code: string;    // as indexed by the source, e.g. "LOB-EN001"
  name: string;
  setName: string;
  rarity: string;
};

type Source = {
  id: string;                              // e.g. "ygoprodeck"
  name: string;                            // shown in Settings
  fetchVersion(): Promise<string>;
  fetchPrintings(): Promise<Printing[]>;
};
```

The YGOPRODeck source implements `fetchVersion` with `checkDBVer.php` and `fetchPrintings` by fetching `cardinfo.php`, flattening it to one `Printing` per card-and-set entry, and skipping codes that fail the set-code pattern.

### `cardDatabase`

Owns subscriptions and the downloaded data. Knows nothing about any specific source.

```ts
type Subscription = {
  sourceId: string;
  version: string;
  updatedAt: string;   // ISO timestamp of last successful download
  checkedAt: string;   // ISO timestamp of last version check
  count: number;
  lastError: string | null;
};
```

- `subscriptions() → Subscription[]`
- `subscribe(sourceId, onProgress)`: downloads and stores the source's printings, then records the subscription.
- `unsubscribe(sourceId)`: deletes the subscription and its printings.
- `checkForUpdates() → UpdateResult[]`: for each subscription, calls `fetchVersion`; if it differs from the stored version, downloads and swaps in the new data. Returns, per source, whether it was updated and how many printings were added. Failures are recorded in `lastError` and do not throw.
- `forceRefresh(sourceId, onProgress)`: downloads and swaps in the data regardless of version.
- `find(code) → Printing[]`: all printings for an exact code across all subscribed sources (one per rarity; identical name + set + rarity from two sources is returned once).
- `suggest(code) → string[]`: up to 5 known codes within edit distance 1 of the given code, for the near-miss suggestions.

Printings are stored in IndexedDB tagged with their `sourceId`. Replacing a source's data happens in a single transaction, so a failed or interrupted download leaves the previous data intact.

On app start the printings of all subscribed sources are loaded into an in-memory map keyed by code, so matching is instant. `checkForUpdates` then runs in the background; if it updates anything, the map is rebuilt.

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
| No subscribed database with data on the phone | Scan screen shows a prompt leading to Settings instead of the camera |
| Subscribe or force refresh fails or is interrupted | Error shown on that database's row with Retry; any previous data is kept |
| Automatic check on app open fails or phone is offline | Silent; existing data is used; the error is recorded on the database's row in Settings |
| Camera permission denied or unavailable | Message explaining how to allow the camera, plus a manual code entry field so the app remains usable |
| No text matching the pattern | "No code found — move closer and retry", field left editable |
| Code not in database | "Card not found" with near-miss suggestions, field left editable, Add disabled |
| Unknown region in the code | Language selector starts on "Unknown"; Add stays disabled until a language is chosen |
| Storage write fails (quota) | Error message; the in-memory list is kept so export still works |
| Invalid CSV on import | Error message; current list untouched |

## Offline behaviour

The service worker caches the app shell and the recognition model. Once a card database is downloaded, scanning, matching, and the list all work with no connection. Only subscribing, the update check on app open, and force refresh need the network.

## Testing

- **Unit (Vitest):**
  - `setCode`: extraction, parsing, language mapping, candidates, across English, French, regionless, old European, and special-edition codes.
  - `sources`: the YGOPRODeck source flattening a sample of the real API response and skipping malformed codes (`fetch` mocked).
  - `cardDatabase`, using a fake source and `fake-indexeddb`: subscribe, unsubscribe removing only that source's data, `checkForUpdates` downloading only when the version changed and reporting the number of new printings, `forceRefresh` downloading even when the version is unchanged, a failed download keeping the old data and recording the error, `find` with multiple rarities and across two sources, `suggest`.
  - `cardMatch`: candidate order, French code resolving to the English entry.
  - `collection`: add/merge/quantity/remove, same code with different language or rarity kept as separate entries, corrupt storage.
  - `csv`: round trip, quoting, bad input.
- **Manual on real phones:** camera, recognition accuracy, subscribing, the update check on app open, install to home screen, on one iPhone (Safari) and one Android phone (Chrome).

## Milestones

1. **Scan proof.** Project scaffold, `camera`, `ocr`, `setCode`, and a bare Scan screen that shows the recognised code and detected language. Deployed to GitHub Pages and tried on a real phone with real cards. If recognition is unusable, stop and revisit the approach before building further.
2. **Databases and matching.** `sources`, `cardDatabase`, `cardMatch`, the Settings screen with subscribe and force refresh, the update check on app open, and the full result panel with language and rarity selectors.
3. **List, export, install.** `collection`, the My cards screen, `csv`, the PWA manifest, service worker, and icons.

## Requirements on the user

- A GitHub account and a repository for hosting on GitHub Pages.
- A phone and a few cards, ideally in more than one language, for the milestone 1 test.
