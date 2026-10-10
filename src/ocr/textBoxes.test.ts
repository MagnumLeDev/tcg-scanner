import { describe, expect, it } from 'vitest';
import { findTextBoxes } from './textBoxes';

// A 100 x 60 map of how likely each pixel is to be text, with text where `text` says so.
function map(text: (x: number, y: number) => boolean): Float32Array {
  const data = new Float32Array(100 * 60);
  for (let y = 0; y < 60; y++) for (let x = 0; x < 100; x++) data[y * 100 + x] = text(x, y) ? 0.9 : 0.01;
  return data;
}
const inside = (left: number, top: number, w: number, h: number) => (x: number, y: number) =>
  x >= left && x < left + w && y >= top && y < top + h;

describe('findTextBoxes', () => {
  it('finds nothing in an empty map', () => {
    expect(findTextBoxes(map(() => false), 100, 60)).toEqual([]);
  });

  it('returns one box per region, grown to cover the whole letters', () => {
    // The model marks the core of a line; the letters reach about 3/4 of its height further out.
    const boxes = findTextBoxes(map(inside(30, 20, 40, 8)), 100, 60);
    expect(boxes).toEqual([{ left: 24, top: 14, right: 75, bottom: 33 }]);
  });

  it('keeps separate lines apart', () => {
    const top = inside(10, 5, 30, 4);
    const bottom = inside(10, 40, 30, 4);
    expect(findTextBoxes(map((x, y) => top(x, y) || bottom(x, y)), 100, 60)).toHaveLength(2);
  });

  it('does not let a box leave the map', () => {
    const [box] = findTextBoxes(map(inside(0, 0, 40, 8)), 100, 60);
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
  });

  it('ignores regions too small to be text', () => {
    expect(findTextBoxes(map(inside(50, 30, 3, 2)), 100, 60)).toEqual([]);
  });

  it('ignores pixels below the threshold', () => {
    const data = new Float32Array(100 * 60).fill(0.2);
    expect(findTextBoxes(data, 100, 60)).toEqual([]);
  });
});
