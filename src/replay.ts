// Development only: runs saved pictures through the same reader, database and
// detector as the Scan screen, so that changes can be measured on real cards.
import { createCardDatabase } from './cardDatabase';
import { match } from './cardMatch';
import type { Line } from './ocr/decode';
import { createDetector, inOneLanguage, type Detection } from './detector';
import { prepare, readCodes, readName, recognise, restart } from './ocr/ocr';
import { createScanner } from './scanner';
import { candidateCodes, type Language } from './setCode';
import { SOURCES } from './sources';

type Rect = { x: number; y: number; width: number; height: number }; // fractions of the picture

const READINGS = 4; // looks at each picture, as long as nothing is detected
const CROP_WIDTH = 1000; // about what the phone camera gives for the outline

const db = createCardDatabase(SOURCES, indexedDB);

const ready = (async () => {
  await db.load();
  if (!db.hasData()) await db.subscribe(SOURCES[0].id);
  else await db.checkForUpdates(); // as the app does when it opens: fetches what is new or missing
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

async function replay(pictureUrl: string, card: Rect, language: Language) {
  await ready;
  const image = new Image();
  image.src = pictureUrl;
  await image.decode();
  const canvas = crop(image, card);

  restart();
  const cards = inOneLanguage({ find: (code) => match(db, code), findByName: db.findByName, printingsOf: db.printingsOf }, language);
  const detector = createDetector(cards);
  let looks = 0;
  const scanner = createScanner<HTMLCanvasElement>({
    reader: { readName, readCodes, readAll: (picture) => recognise(picture) },
    findByName: cards.findByName,
    isCode: (text) => candidateCodes(text).some((code) => cards.find(code) !== null),
    printingsOf: cards.printingsOf,
    feed: detector.feed,
    glance: () => [looks++ * 100], // every look counts as a new picture: nothing is skipped
  });
  const readings = [];
  let detected: Detection | null = null;
  for (let i = 0; i < READINGS && !detected; i++) {
    const started = performance.now();
    const { detection, reading: read } = await scanner.look(canvas);
    const milliseconds = Math.round(performance.now() - started);
    const show = (lines: Line[]) => lines.map((line) => `${line.text} (${Math.round(line.confidence * 100)}%)`);
    readings.push({ milliseconds, codes: show(read?.codes ?? []), names: show(read?.names ?? []) });
    detected = detection;
  }
  const named = readings.flatMap((reading) => reading.names).map((text) => cards.findByName(text.replace(/ \(\d+%\)$/, '')))[0] ?? null;
  return { detected, named, readings };
}

(window as unknown as { replay: typeof replay }).replay = replay;
