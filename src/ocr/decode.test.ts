import { describe, expect, it } from 'vitest';
import { decode } from './decode';

const CHARACTERS = ['', 'A', 'B', '-']; // position 0 is "nothing here"

// One row of scores per step; the best score in a row is the character read at that step.
function scores(...steps: number[][]): Float32Array {
  return new Float32Array(steps.flat());
}

describe('decode', () => {
  it('reads the best character of each step', () => {
    const data = scores([0, 0.9, 0.1, 0], [0, 0, 0.1, 0.8], [0, 0.1, 0.7, 0]);
    expect(decode(data, 3, 4, CHARACTERS).text).toBe('A-B');
  });

  it('skips steps where nothing is read', () => {
    const data = scores([0.9, 0.1, 0, 0], [0, 0.9, 0, 0], [0.8, 0, 0.1, 0]);
    expect(decode(data, 3, 4, CHARACTERS).text).toBe('A');
  });

  it('reads a character held over several steps once', () => {
    const data = scores([0, 0.9, 0, 0], [0, 0.8, 0, 0], [0, 0, 0.9, 0]);
    expect(decode(data, 3, 4, CHARACTERS).text).toBe('AB');
  });

  it('reads a doubled letter when a gap separates the two', () => {
    const data = scores([0, 0.9, 0, 0], [0.9, 0, 0, 0], [0, 0.9, 0, 0]);
    expect(decode(data, 3, 4, CHARACTERS).text).toBe('AA');
  });

  it('gives the score of the least certain character as confidence', () => {
    const data = scores([0, 0.9, 0.1, 0], [0, 0, 0.1, 0.6], [0.99, 0, 0, 0]);
    expect(decode(data, 3, 4, CHARACTERS).confidence).toBeCloseTo(0.6, 5);
  });

  it('has no confidence in an empty reading', () => {
    expect(decode(scores([0.9, 0, 0, 0]), 1, 4, CHARACTERS)).toEqual({ text: '', confidence: 0 });
  });
});
