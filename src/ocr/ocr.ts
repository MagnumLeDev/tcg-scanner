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
