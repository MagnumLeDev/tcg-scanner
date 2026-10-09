import { describe, expect, it } from 'vitest';
import { binarise, keepTextSizedInk } from './preprocess';

// Builds RGBA data from a function giving the grey level of each pixel.
function image(width: number, height: number, grey: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = grey(x, y);
      data[o + 3] = 255;
    }
  }
  return data;
}

const at = (data: Uint8ClampedArray, width: number, x: number, y: number) => data[(y * width + x) * 4];
const isStroke = (x: number, y: number) => y >= 30 && y < 34 && x >= 10 && x < 90;

describe('binarise', () => {
  it('turns dark strokes black and their background white', () => {
    const data = image(100, 64, (x, y) => (isStroke(x, y) ? 40 : 200));
    binarise(data, 100, 64, false);
    expect(at(data, 100, 50, 31)).toBe(0);
    expect(at(data, 100, 50, 10)).toBe(255);
    expect(at(data, 100, 50, 50)).toBe(255);
  });

  it('is not thrown off by a background that goes from dark to light', () => {
    // The stroke is always 60 darker than what surrounds it, on a 60 -> 240 gradient.
    const data = image(100, 64, (x, y) => 60 + Math.round(x * 1.8) - (isStroke(x, y) ? 60 : 0));
    binarise(data, 100, 64, false);
    for (const x of [15, 50, 85]) {
      expect(at(data, 100, x, 31)).toBe(0);
      expect(at(data, 100, x, 12)).toBe(255);
    }
  });

  it('turns light strokes black when asked for light text', () => {
    const data = image(100, 64, (x, y) => (isStroke(x, y) ? 230 : 40));
    binarise(data, 100, 64, true);
    expect(at(data, 100, 50, 31)).toBe(0);
    expect(at(data, 100, 50, 10)).toBe(255);
  });

  it('ignores light strokes when asked for dark text', () => {
    const data = image(100, 64, (x, y) => (isStroke(x, y) ? 230 : 40));
    binarise(data, 100, 64, false);
    expect(at(data, 100, 50, 31)).toBe(255);
  });

  it('leaves a flat or slightly noisy area white', () => {
    const data = image(100, 64, (x, y) => 120 + ((x * 7 + y * 13) % 5));
    binarise(data, 100, 64, false);
    expect(data.filter((value, index) => index % 4 === 0 && value === 0).length).toBe(0);
  });

  it('writes the same value to red, green and blue and keeps alpha', () => {
    const data = image(100, 64, (x, y) => (isStroke(x, y) ? 40 : 200));
    binarise(data, 100, 64, false);
    const o = (31 * 100 + 50) * 4;
    expect([data[o], data[o + 1], data[o + 2], data[o + 3]]).toEqual([0, 0, 0, 255]);
  });
});

describe('keepTextSizedInk', () => {
  // A 400 x 200 black-on-white picture with ink wherever `ink` says so.
  const picture = (ink: (x: number, y: number) => boolean) => image(400, 200, (x, y) => (ink(x, y) ? 0 : 255));
  const box = (left: number, top: number, w: number, h: number) => (x: number, y: number) =>
    x >= left && x < left + w && y >= top && y < top + h;

  it('keeps a letter-sized shape', () => {
    const data = picture(box(50, 50, 10, 16));
    keepTextSizedInk(data, 400, 200);
    expect(at(data, 400, 55, 58)).toBe(0);
  });

  it('keeps a hyphen-sized shape', () => {
    const data = picture(box(50, 50, 8, 3));
    keepTextSizedInk(data, 400, 200);
    expect(at(data, 400, 54, 51)).toBe(0);
  });

  it('removes a long line such as the edge of a frame', () => {
    const data = picture(box(20, 100, 300, 3));
    keepTextSizedInk(data, 400, 200);
    expect(at(data, 400, 150, 101)).toBe(255);
  });

  it('removes a tall shape such as a piece of the artwork', () => {
    const data = picture(box(100, 20, 12, 90));
    keepTextSizedInk(data, 400, 200);
    expect(at(data, 400, 105, 60)).toBe(255);
  });

  it('removes specks', () => {
    const data = picture((x, y) => x === 70 && y === 70);
    keepTextSizedInk(data, 400, 200);
    expect(at(data, 400, 70, 70)).toBe(255);
  });

  it('removes a large shape without touching a letter beside it', () => {
    const big = box(100, 20, 150, 150);
    const letter = box(300, 50, 10, 16);
    const data = picture((x, y) => big(x, y) || letter(x, y));
    keepTextSizedInk(data, 400, 200);
    expect(at(data, 400, 150, 100)).toBe(255);
    expect(at(data, 400, 305, 58)).toBe(0);
  });
});
