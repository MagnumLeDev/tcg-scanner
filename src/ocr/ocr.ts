import { createWorker, PSM, type Worker } from 'tesseract.js';
import { extract } from '../setCode';
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

// Downloads and starts the text reader ahead of the first scan, so that the
// first scan is quick and scanning works offline afterwards.
export async function prepare(): Promise<void> {
  await getWorker();
}

// Reads the crop; if no set code comes out, reads it again with the opposite
// polarity, because the automatic dark/light choice can be wrong on some frames.
export async function recognise(source: HTMLCanvasElement): Promise<string> {
  const first = await read(source, false);
  if (extract(first) !== null) return first;
  const second = await read(source, true);
  return extract(second) !== null ? second : first;
}

async function read(source: HTMLCanvasElement, flip: boolean): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = source.width * SCALE;
  canvas.height = source.height * SCALE;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  toHighContrastGrey(image.data, flip);
  context.putImageData(image, 0, 0);

  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  return data.text;
}
