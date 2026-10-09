import { describe, expect, it } from 'vitest';
import { toHighContrastGrey } from './preprocess';

function pixels(...greys: number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(greys.length * 4);
  greys.forEach((g, i) => data.set([g, g, g, 255], i * 4));
  return data;
}

function greys(data: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 4) out.push(data[i]);
  return out;
}

describe('toHighContrastGrey', () => {
  it('stretches dark text on a light background to full black and white', () => {
    const data = pixels(150, 150, 100, 150);
    toHighContrastGrey(data);
    expect(greys(data)).toEqual([255, 255, 0, 255]);
  });

  it('inverts light text on a dark background so text ends up dark', () => {
    const data = pixels(40, 40, 220, 40);
    toHighContrastGrey(data);
    expect(greys(data)).toEqual([255, 255, 0, 255]);
  });

  it('writes the same value to red, green and blue and keeps alpha', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 200, 255, 255, 255, 200, 255, 255, 255, 200]);
    toHighContrastGrey(data);
    expect([...data]).toEqual([0, 0, 0, 200, 255, 255, 255, 200, 255, 255, 255, 200]);
  });

  it('leaves a uniform image unchanged', () => {
    const data = pixels(90, 90, 90);
    toHighContrastGrey(data);
    expect(greys(data)).toEqual([90, 90, 90]);
  });

  it('does nothing on empty input', () => {
    const data = new Uint8ClampedArray(0);
    expect(() => toHighContrastGrey(data)).not.toThrow();
  });
});
