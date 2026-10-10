import { describe, expect, it } from 'vitest';
import { sampleFileName } from './sample';

const AT = new Date(2026, 9, 10, 8, 5, 9); // 10 October 2026, 08:05:09 local time

describe('sampleFileName', () => {
  it('starts with the code typed by the user, then the time', () => {
    expect(sampleFileName('RA03-FR002', AT)).toBe('RA03-FR002_20261010-080509.png');
  });

  it('tidies the typed code', () => {
    expect(sampleFileName(' ra03 - fr002 ', AT)).toBe('RA03-FR002_20261010-080509.png');
  });

  it('uses "unknown" when nothing usable was typed', () => {
    expect(sampleFileName('', AT)).toBe('unknown_20261010-080509.png');
    expect(sampleFileName('hello', AT)).toBe('unknown_20261010-080509.png');
  });
});
