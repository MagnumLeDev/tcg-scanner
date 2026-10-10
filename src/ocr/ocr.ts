import * as ort from 'onnxruntime-web/wasm';
import { decode, type Line } from './decode';
import { detectionInput, recognitionInput } from './tensors';
import { findTextBoxes, type Box } from './textBoxes';

const DETECTION_SIDE = 960; // the picture is shrunk to at most this size to find text
const LINE_HEIGHT = 48; // the height at which the reading model takes a line
const MAX_LINE_WIDTH = 480;
const MAX_LINES = 8; // lines read per picture, to bound the work
const CODE_SHAPE = 5.5; // a set code is about this many times wider than tall

type Reader = { detection: ort.InferenceSession; recognition: ort.InferenceSession; characters: string[] };

let readerPromise: Promise<Reader> | null = null;
let lastPicture: HTMLCanvasElement | null = null;

// On a first visit the service worker may not be in charge of the page yet, and
// what is downloaded before that is not kept for offline use. So the (large)
// reader files are only fetched once it is, or after a short wait if it never is.
async function serviceWorkerInCharge(): Promise<void> {
  if (!('serviceWorker' in navigator) || navigator.serviceWorker.controller) return;
  if (!(await navigator.serviceWorker.getRegistration())) return;
  await new Promise<void>((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    setTimeout(resolve, 4000);
  });
}

function getReader(): Promise<Reader> {
  if (!readerPromise) {
    readerPromise = (async () => {
      await serviceWorkerInCharge();
      const base = new URL('.', document.baseURI).href;
      ort.env.wasm.numThreads = 1; // more would need server settings a static host cannot give
      const [detection, recognition, text] = await Promise.all([
        ort.InferenceSession.create(`${base}models/det.onnx`),
        ort.InferenceSession.create(`${base}models/rec.onnx`),
        fetch(`${base}models/characters.txt`).then((response) => {
          if (!response.ok) throw new Error(`the character list could not be loaded (${response.status})`);
          return response.text();
        }),
      ]);
      // Position 0 stands for "nothing here"; a space comes after the listed characters.
      return { detection, recognition, characters: ['', ...text.split('\n'), ' '] };
    })();
    // A failed load (e.g. offline on first use) must not be remembered forever.
    readerPromise.catch(() => {
      readerPromise = null;
    });
  }
  return readerPromise;
}

// Downloads and starts the text reader ahead of the first scan, so that
// scanning starts quickly and works offline afterwards.
export async function prepare(): Promise<void> {
  await getReader();
}

// The picture most recently read, with the lines that were read outlined, for the details view.
export function pictureLastRead(): HTMLCanvasElement | null {
  return lastPicture;
}

// The part of the picture looked at more closely on every other reading: where
// the set code is when the card is roughly inside the outline. Small or faint
// print that is missed in the whole picture is often found at this size.
const CLOSE_UP = { left: 0.3, top: 0.52, width: 0.7, height: 0.36 };

let closeUpNext = false;

// Makes the next reading a whole-picture one, so that replays always start the same way.
export function restart(): void {
  closeUpNext = false;
}

// Finds the lines of text in the picture and reads those shaped like a set code.
// Readings alternate between the whole picture and a close-up of part of it.
export async function recognise(whole: HTMLCanvasElement): Promise<Line[]> {
  if (whole.width === 0 || whole.height === 0) return [];
  const reader = await getReader();
  const source = closeUpNext ? cut(whole, CLOSE_UP) : whole;
  closeUpNext = !closeUpNext;

  // The model that finds text wants sides that are multiples of 32.
  const shrink = Math.min(1, DETECTION_SIDE / Math.max(source.width, source.height));
  const width = Math.max(32, Math.round((source.width * shrink) / 32) * 32);
  const height = Math.max(32, Math.round((source.height * shrink) / 32) * 32);
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const context = small.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  const found = await reader.detection.run({
    [reader.detection.inputNames[0]]: new ort.Tensor('float32', detectionInput(pixels, width, height), [1, 3, height, width]),
  });
  const probability = found[reader.detection.outputNames[0]].data as Float32Array;

  const shape = (box: Box) => (box.right - box.left + 1) / (box.bottom - box.top + 1);
  const boxes = findTextBoxes(probability, width, height)
    .filter((box) => shape(box) >= 2.5 && shape(box) <= 11)
    .sort((a, b) => Math.abs(shape(a) - CODE_SHAPE) - Math.abs(shape(b) - CODE_SHAPE))
    .slice(0, MAX_LINES);

  const lines: Line[] = [];
  const scaleX = source.width / width;
  const scaleY = source.height / height;
  for (const box of boxes) {
    lines.push(await readLine(reader, source, {
      left: box.left * scaleX,
      top: box.top * scaleY,
      right: (box.right + 1) * scaleX,
      bottom: (box.bottom + 1) * scaleY,
    }));
  }

  context.strokeStyle = '#ff2d55';
  context.lineWidth = 2;
  for (const box of boxes) context.strokeRect(box.left, box.top, box.right - box.left + 1, box.bottom - box.top + 1);
  lastPicture = small;

  return lines.filter((line) => line.text !== '');
}

function cut(picture: HTMLCanvasElement, part: typeof CLOSE_UP): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(picture.width * part.width);
  canvas.height = Math.round(picture.height * part.height);
  canvas
    .getContext('2d')!
    .drawImage(picture, picture.width * part.left, picture.height * part.top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Reads one line, cut out of the full-size picture so that small print keeps its detail.
async function readLine(reader: Reader, source: HTMLCanvasElement, box: Box): Promise<Line> {
  const boxWidth = box.right - box.left;
  const boxHeight = box.bottom - box.top;
  const width = Math.max(8, Math.min(MAX_LINE_WIDTH, Math.round((boxWidth * LINE_HEIGHT) / boxHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = LINE_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, box.left, box.top, boxWidth, boxHeight, 0, 0, width, LINE_HEIGHT);
  const pixels = context.getImageData(0, 0, width, LINE_HEIGHT).data;

  const read = await reader.recognition.run({
    [reader.recognition.inputNames[0]]: new ort.Tensor('float32', recognitionInput(pixels, width, LINE_HEIGHT), [1, 3, LINE_HEIGHT, width]),
  });
  const output = read[reader.recognition.outputNames[0]];
  return decode(output.data as Float32Array, output.dims[1], output.dims[2], reader.characters);
}
