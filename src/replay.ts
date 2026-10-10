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
