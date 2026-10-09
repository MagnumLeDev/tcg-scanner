# Yu-Gi-Oh Card Scanner — Design

Date: 2026-10-09

## Purpose

A phone app for Maxime and a few friends, on iPhone and Android, that:

1. Reads the set code printed under a Yu-Gi-Oh card's artwork (e.g. `LOB-EN001`) with the camera.
2. Keeps a list of the cards scanned on that phone.
3. Gives each card a button that opens its page on Cardmarket.

It will never be published on an app store. Success means a friend can open a link, install the app to their home screen, scan a card in a few seconds, and reach its Cardmarket page in one tap.

## Approach

A Progressive Web App (PWA): a website that is installed with "Add to Home Screen" and runs full screen with camera access. This was chosen over a native app because it reaches iPhones without a paid Apple Developer account or per-device registration, and one codebase serves both platforms.

Text recognition runs in the browser. This is less accurate than native recognition, so the design constrains the problem: a small aiming frame, a restricted character set, pattern validation, and manual correction.

## Scope

In scope for version 1:

- Scan screen with camera, aiming frame, capture, and confirm/correct step
- Card lookup by set code
- Card list with quantity, delete, and Cardmarket button
- CSV export and import
- Installable, list viewable offline

Out of scope:

- Prices in the app
- Accounts, sync, or shared lists
- Continuous (hands-free) scanning
- Interface languages other than English
- Recognising a card from its artwork or name

## Stack

| Part | Choice |
|---|---|
| Framework | React + TypeScript, built with Vite |
| Text recognition | Tesseract.js (English model) |
| Storage | `localStorage` |
| PWA | `vite-plugin-pwa` (manifest + service worker) |
| Tests | Vitest |
| Hosting | GitHub Pages, deployed by a GitHub Actions workflow |
| Location | `~/projects/ygo-scanner` |

## Screens

### Scan

- Live rear-camera preview (`getUserMedia` with `facingMode: "environment"`, video element with `playsinline` for iOS).
- A fixed rectangular frame overlaid on the preview, wide and short, sized for one line of text.
- A capture button. On tap, the app grabs the current frame, runs recognition, and shows a result panel.
- Result panel:
  - Editable text field holding the recognised code.
  - Lookup result: card name, set name, rarity — or a "not found" message.
  - "Add" button (enabled only when a card is found) and "Retry" button.
  - Editing the field re-runs the lookup when the text matches the set-code pattern.

### My cards

- One row per distinct printed set code: card name, set code as printed, set name, rarity, quantity.
- Per row: Cardmarket button, quantity − / +, delete. Quantity − at 1 asks before deleting.
- Export CSV and Import CSV buttons.
- Empty state pointing to the Scan screen.

Navigation is a two-tab bottom bar: Scan, My cards.

## Modules

Each module has one job and a small interface. Everything except `camera` and `ocr` is pure logic and unit-tested.

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
- `parse(code) → { prefix, region, number }`: `number` is the last 3 characters; `region` is the 0–2 letters between the hyphen and `number`. So `LOB-EN001` → `LOB / EN / 001`, `SDY-046` → `SDY / "" / 046`, `DUEA-ENSE1` → `DUEA / EN / SE1`.
- `lookupCandidates(code) → string[]`: the ordered list of codes to try against the database:
  1. the code as read
  2. the code with misread fixes in `number` (`O→0`, `I→1`, `L→1`), if that differs
  3. each of the above with `region` replaced by `EN`
  4. each of the above with `region` removed

  Duplicates are removed. This handles non-English prints (`LOB-FR001` → `LOB-EN001`) and old European prints (`LOB-E001` → `LOB-EN001` or `LOB-001`).

### `cardLookup`

`lookup(code) → Card | null`. For each candidate from `setCode.lookupCandidates`, calls

```
GET https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?setcode=<candidate>
```

and returns the first hit as `{ name, setName, rarity, matchedCode }`. Results (including misses) are cached in memory for the session. Network failure is reported as an error distinct from "not found".

### `cardmarket`

`url(card) → string`. Pure function.

- Direct link: `https://www.cardmarket.com/en/YuGiOh/Products/Singles/<set-slug>/<card-slug>`, where a slug is the name with non-alphanumeric runs replaced by `-`.
- Search link: `https://www.cardmarket.com/en/YuGiOh/Products/Search?searchString=<card name>`.

The browser cannot check whether a Cardmarket URL exists, so the app cannot fall back at runtime. The choice is made once, during the first milestone: the direct-link rule is checked by hand against 10 varied cards (including names with punctuation, and a card with several rarities in one set). If all 10 open the right product page, the button uses the direct link; otherwise the button uses the search link. The same check determines whether a `language` query parameter can pre-select the printed language, and it is added only if it works.

The button opens the URL in a new tab (`target="_blank"`, `rel="noopener"`).

### `collection`

Owns the list and its persistence.

```ts
type Entry = {
  code: string;        // as printed, e.g. "LOB-FR001" — the unique key
  matchedCode: string; // code the database matched, e.g. "LOB-EN001"
  name: string;
  setName: string;
  rarity: string;
  quantity: number;
  addedAt: string;     // ISO timestamp
};
```

Operations: `add(card, code)` (increments quantity if `code` exists), `setQuantity`, `remove`, `all`, `replaceAll`. State is stored as JSON under the `localStorage` key `ygo-scanner.collection.v1`. Corrupt or missing data loads as an empty list.

### `csv`

- `toCsv(entries) → string` with header `code,matched_code,name,set_name,rarity,quantity,added_at`, quoting fields that contain commas, quotes, or newlines.
- `fromCsv(text) → Entry[]`, rejecting files with a wrong header and skipping malformed rows, reporting how many were skipped.

Import asks whether to **merge** (add quantities for matching codes) or **replace** the current list.

## Error handling

| Situation | Behaviour |
|---|---|
| Camera permission denied or unavailable | Message explaining how to allow the camera, plus a manual code entry field so the app remains usable |
| No text matching the pattern | "No code found — move closer and retry", field left editable |
| Code not in database | "Card not found", field left editable, Add disabled |
| Network error on lookup | "No connection" message with Retry; nothing is added |
| Storage write fails (quota) | Error message; the in-memory list is kept so export still works |
| Invalid CSV on import | Error message; current list untouched |

## Offline behaviour

The service worker caches the app shell and the recognition model. The list is viewable and editable offline. Scanning needs a connection for the lookup.

## Testing

- **Unit (Vitest):** `setCode` (extraction, parsing, candidates, across English, French, regionless, old European, and special-edition codes), `collection` (add/merge/quantity/remove, corrupt storage), `csv` (round trip, quoting, bad input), `cardmarket` (slug and URL building), `cardLookup` (candidate order, caching, not-found vs. network error, with `fetch` mocked).
- **Manual on real phones:** camera, recognition accuracy, install to home screen, on one iPhone (Safari) and one Android phone (Chrome).

## Milestones

1. **Scan proof.** Project scaffold, `camera`, `ocr`, `setCode`, and a bare Scan screen that shows the recognised code. Deployed to GitHub Pages and tried on a real phone with real cards. The Cardmarket link check also happens here. If recognition is unusable, stop and revisit the approach before building further.
2. **Lookup and list.** `cardLookup`, `collection`, the result panel, and the My cards screen with the Cardmarket button.
3. **Export, import, install.** `csv`, the PWA manifest, service worker, and icons.

## Requirements on the user

- A GitHub account and a repository for hosting on GitHub Pages.
- A phone and a few cards for the milestone 1 test.
