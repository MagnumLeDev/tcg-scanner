import { describe, expect, it } from 'vitest';
import { readScanLanguage, saveScanLanguage, SCAN_LANGUAGES, SCAN_LANGUAGE_KEY } from './scanLanguage';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe('scan language', () => {
  it('offers every language but Unknown', () => {
    expect(SCAN_LANGUAGES).toContain('French');
    expect(SCAN_LANGUAGES).toContain('Japanese');
    expect(SCAN_LANGUAGES).not.toContain('Unknown');
  });

  it('gives back the language chosen last', () => {
    const store = storage();
    saveScanLanguage(store, 'Italian');
    expect(readScanLanguage(store, 'en-US')).toBe('Italian');
  });

  it('starts from the language of the phone when nothing was chosen', () => {
    expect(readScanLanguage(storage(), 'fr-FR')).toBe('French');
    expect(readScanLanguage(storage(), 'de')).toBe('German');
    expect(readScanLanguage(storage(), 'pt-BR')).toBe('Portuguese');
    expect(readScanLanguage(storage(), 'ja-JP')).toBe('Japanese');
  });

  it('starts from English for any other phone language', () => {
    expect(readScanLanguage(storage(), 'nl-NL')).toBe('English');
    expect(readScanLanguage(storage(), '')).toBe('English');
  });

  it('ignores a saved value that is not a language', () => {
    expect(readScanLanguage(storage({ [SCAN_LANGUAGE_KEY]: 'Klingon' }), 'fr')).toBe('French');
    expect(readScanLanguage(storage({ [SCAN_LANGUAGE_KEY]: 'Unknown' }), 'fr')).toBe('French');
  });

  it('works when storage cannot be used', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(readScanLanguage(broken, 'it-IT')).toBe('Italian');
    expect(() => saveScanLanguage(broken, 'French')).not.toThrow();
  });
});
