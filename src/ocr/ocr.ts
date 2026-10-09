import { createWorker, PSM, type Worker } from 'tesseract.js';
import { binarise, keepTextSizedInk } from './preprocess';

const SCALE = 2;
const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: WHITELIST,
        // The crop is a band of the card, not a tight box: the code can be anywhere in it.
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
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

// Downloads and starts the text reader ahead of the first scan, so that the
// first scan is quick and scanning works offline afterwards.
export async function prepare(): Promise<void> {
  await getWorker();
}

let lastPicture: HTMLCanvasElement | null = null;

// The cleaned-up picture most recently given to the text reader, for the details view.
export function pictureLastRead(): HTMLCanvasElement | null {
  return lastPicture;
}

// Reads every piece of text in the crop. The crop is cleaned up twice, once for
// dark text and once for light text, and both versions are read in one go, one
// above the other, because the frame colour of the card is not known in advance.
export async function recognise(source: HTMLCanvasElement): Promise<string> {
  const width = source.width * SCALE;
  const height = source.height * SCALE;
  if (width === 0 || height === 0) return '';

  const enlarged = document.createElement('canvas');
  enlarged.width = width;
  enlarged.height = height;
  const context = enlarged.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingEnabled = true;
  context.drawImage(source, 0, 0, width, height);

  const stacked = document.createElement('canvas');
  stacked.width = width;
  stacked.height = height * 2;
  const output = stacked.getContext('2d')!;
  for (const lightText of [false, true]) {
    const image = context.getImageData(0, 0, width, height);
    binarise(image.data, width, height, lightText);
    keepTextSizedInk(image.data, width, height);
    output.putImageData(image, 0, lightText ? height : 0);
  }

  const worker = await getWorker();
  lastPicture = stacked;
  const { data } = await worker.recognize(stacked);
  return data.text;
}
