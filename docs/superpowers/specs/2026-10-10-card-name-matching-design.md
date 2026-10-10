# Card Name Matching — Design

Date: 2026-10-10

## Purpose

Today a card is identified only by its set code, and the code must be read exactly. Cards are missed when one character of the code is misread, or when the code is too faint to be found at all (foil cards such as `IMG_9755`).

This change makes every scan also read the card name, and uses the name and the code together to pick the most probable card in the database.

Success means:

- A card whose code is read one character off is identified when its name is read.
- A card whose code is not read at all is identified by name, and the user picks the printing.
- A card whose code and name both read correctly is accepted on the first reading.
- Scanning stays as fast and as light on the phone as it is now (see Performance).

## Scope

In scope:

- Card names in English, French, German, Italian and Portuguese, stored with the card database
- Reading the name line on the whole-picture reading
- A name index that finds the card a read name most probably belongs to
- A detector that combines code and name across readings
- A result panel that can open on a card with no code yet
- A replay test over the pictures in `projects/ressources`

Out of scope:

- Names on Spanish and Chinese cards: YGOPRODeck has no names in these languages
- Names on Japanese and Korean cards: names exist, but the text reader cannot read kana or hangul; each would need another reader model of about 10 MB
- Recognising a card from its artwork
- Any change to the close-up reading or to how the code is parsed

Cards in the out-of-scope languages keep scanning by code exactly as they do today.

## Card names in the database

### Source

`Source` gains:

```ts
nameLanguages: Language[];                                   // languages other than English it has names in
fetchNames(language: Language): Promise<[number, string][]>; // [card id, name in that language]
```

`Printing` gains `cardId: number`, taken from the `id` field YGOPRODeck already returns. It joins printings to names.

For YGOPRODeck, `fetchNames` calls `cardinfo.php?language=fr|de|it|pt` and keeps only `id` and `name` of each card. Each response is about 2.8 MB compressed and 19 MB once unpacked, so languages are fetched one after the other, never in parallel, and each response is dropped as soon as its names are extracted.

English names come from the printings themselves and need no extra download.

### Storage

The IndexedDB database moves to version 2 with a new object store `names`: one record per source, key = source id, value = `{ [language]: [cardId, name][] }`. About 1.5 MB for four languages.

### When names are downloaded

- With the printings, on subscribe, on update and on force refresh. Printings are saved first, so the app is usable by code before the names arrive.
- On the update check at app open, when a subscription has no names for a language, or has printings without `cardId` (data saved before this change). This is how existing installs get names without the user doing anything.

A language that fails to download does not fail the update: the others are kept, and the missing one is tried again at the next update check. Settings shows the database as up to date; no new control is added.

### Lookup

The card database gains:

```ts
findByName(text: string): NameMatch | null; // { cardId, name, language, score }
printingsOf(cardId: number): Printing[];
```

`find` and `suggest` are unchanged.

## Name index (`src/nameIndex.ts`)

A pure module, built once whenever the database's data changes, from every name in every language (about 60 000 entries).

- **Normalising:** lower case, accents removed (Unicode decomposition, combining marks dropped), everything but `a-z0-9` removed. The reader's character list lacks several accented letters (`ç`, `ñ`, `ã`, `ß`, `œ`), so matching must not depend on them.
- **Index:** each normalised name is filed under its three-letter sequences. A lookup collects the names sharing the most sequences with the text read and keeps the best 20.
- **Scoring:** those 20 are scored by edit distance: `score = 1 − distance / length of the longer text`.
- **Result:** the best card, when its score is at least 0.8, its normalised name is at least 4 characters long, and it beats the best *different* card by at least 0.1. Otherwise nothing. The same card found under two languages is not a competitor to itself; the language of the best-scoring name is reported, or `Unknown` when the name is spelled the same in several languages, so that the user chooses it.

A name that is the start of longer names ("Dark Magician", "Dark Magician Girl") is safe: the reading of the full line is compared with full names.

## Reading the name (`src/ocr/ocr.ts`)

The whole-picture reading already locates every line of text. Among the boxes found, name lines are those whose centre lies in the top 22 % of the picture and that span at least 35 % of its width. The two widest are read, at a maximum line width of 640 instead of 480, since names are long.

`recognise` returns `{ codes: Line[]; names: Line[] }` instead of `Line[]`. The close-up reading returns no names. Name boxes are outlined in a second colour in the details view, and the details text shows the name read.

## Combining code and name (`src/detector.ts`)

`feed` takes the result of one reading. The detector is given `find` (as today), `findByName` and `printingsOf`. A code one character away is looked for among the named card's own printings.

Because the name comes from whole-picture readings and the code often from close-ups, the detector remembers the last name match for 3 readings.

| Code read | Name match in memory | Result |
|---|---|---|
| Exists in database | Same card | Accepted at once, at any confidence |
| Exists in database | None | As today: confidence ≥ 0.8, or read twice within 3 readings |
| Exists in database | A different card, read in this same reading, which has a printing one character away from the code read | The named card's printing is accepted |
| Exists in database | Any other different card | Not accepted on one reading; accepted when the code is read twice within 3 readings |
| Not in database | A card that has a printing one character away from a code candidate | That printing is accepted |
| None | Same name match in two readings within 3 | Accepted as a card with no code |

The rows are tried from top to bottom; the first that applies decides.

A detection is either `{ code, match }` as today, or `{ cardId, name, language }` for the last row.

A name remembered from an earlier reading never overrides a code that exists: the card may have been swapped in between.

Dismissing works as today for codes, and the dismissed card is also not reported by its name; another printing of the same card can be scanned at once. A card accepted by name is dismissed under its name and all its codes, and released after 2 whole-picture readings without it (close-ups cannot show a name, so they do not count).

## Result panel

`ResultPanel` takes either an initial code (today) or an initial card. Opened on a card, it shows the card's name and a "Printing" list of that card's codes with their set names, and the language is pre-set to the language the name was read in. Choosing a printing fills the code field with that printing's code written for the language the name was read in (`RA01-EN051` becomes `RA01-FR051`); from there the panel behaves as it does today, and the user can still correct the code.

## Performance

Measured on the replay pictures before and after, in a headless browser:

- Name reading adds at most two lines to every other reading. Target: average time per reading rises by no more than 15 %.
- A name lookup takes under 5 ms.
- Building the index takes under 300 ms, once per database load, off the scan path.

The rule that the app rests after each reading for as long as the reading took is unchanged, so processor use stays at about half. If a target is missed, name reading drops to one line before anything else is traded away.

## Error handling

- Names missing (not yet downloaded, or all languages failed): `findByName` returns nothing and the detector behaves exactly as today.
- Name download fails: described above; never blocks code scanning.
- Name read but matches nothing: ignored.

## Testing

- `nameIndex`: normalising, exact and misread names, the 0.8 and 0.1 thresholds, same card in two languages, short names.
- `ygoprodeck`: `cardId` on printings, `fetchNames` extraction, bad data.
- `cardDatabase`: names stored and reloaded, version 1 data upgraded, one language failing, names fetched when missing.
- `detector`: one test per row of the table, name memory expiring, dismissal by card.
- `textBoxes`/`ocr`: choice of name boxes by position and width.
- Replay test: each picture in `projects/ressources` run through reader, name index and detector with the real database. The code and name read for each picture are reported to Maxime, who supplies the real ones; these become the expected values.
