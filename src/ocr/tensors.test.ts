import { describe, expect, it } from 'vitest';
import { detectionInput, recognitionInput } from './tensors';

// Two pixels side by side: pure red, then mid grey.
const RGBA = new Uint8ClampedArray([255, 0, 0, 255, 128, 128, 128, 255]);

describe('detectionInput', () => {
  it('lays the picture out as red plane, green plane, blue plane', () => {
    const input = detectionInput(RGBA, 2, 1);
    expect(input.length).toBe(6);
    expect(input[0]).toBeGreaterThan(input[1]); // red plane: red pixel, then grey pixel
    expect(input[2]).toBeLessThan(input[3]); // green plane
    expect(input[4]).toBeLessThan(input[5]); // blue plane
  });

  it('scales each colour the way the model was trained', () => {
    const input = detectionInput(RGBA, 2, 1);
    expect(input[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
    expect(input[2]).toBeCloseTo((0 - 0.456) / 0.224, 4);
    expect(input[5]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 4);
  });
});

describe('recognitionInput', () => {
  it('lays the picture out as blue plane, green plane, red plane, between -1 and 1', () => {
    const input = recognitionInput(RGBA, 2, 1);
    expect([...input].map((value) => Math.round(value * 100) / 100)).toEqual([-1, 0, -1, 0, 1, 0]);
  });
});
