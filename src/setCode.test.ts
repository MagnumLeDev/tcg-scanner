import { describe, expect, it } from 'vitest';
import { CODE_PATTERN, extract, extractAll, languageOf, lookupCandidates, parse, readingVariants } from './setCode';

describe('extract', () => {
  it('returns a clean code unchanged', () => {
    expect(extract('LOB-EN001')).toBe('LOB-EN001');
    expect(extract('SDY-046')).toBe('SDY-046');
    expect(extract('MP19-EN001')).toBe('MP19-EN001');
    expect(extract('DUEA-ENSE1')).toBe('DUEA-ENSE1');
  });

  it('uppercases and trims hand-typed input', () => {
    expect(extract(' lob-fr001 ')).toBe('LOB-FR001');
  });

  it('accepts spaces around the hyphen and dash variants', () => {
    expect(extract('LOB - EN001')).toBe('LOB-EN001');
    expect(extract('LOB – EN001')).toBe('LOB-EN001');
    expect(extract('LOB—EN001')).toBe('LOB-EN001');
  });

  it('finds the code among other recognised text', () => {
    expect(extract('1ST LOB-EN001 X')).toBe('LOB-EN001');
    expect(extract('LOB-EN001\n')).toBe('LOB-EN001');
  });

  it('returns null when there is no code', () => {
    expect(extract('')).toBeNull();
    expect(extract('HELLO')).toBeNull();
    expect(extract('LOBEN001')).toBeNull();
  });

  it('rejects a code with too many trailing characters', () => {
    expect(extract('LOB-EN0012')).toBeNull();
  });
});

describe('CODE_PATTERN', () => {
  it('matches only a whole code', () => {
    expect(CODE_PATTERN.test('LOB-EN001')).toBe(true);
    expect(CODE_PATTERN.test('LOB-EN001 ')).toBe(false);
    expect(CODE_PATTERN.test('DB49')).toBe(false);
    expect(CODE_PATTERN.test('MF03-EN0??')).toBe(false);
  });
});

describe('parse', () => {
  it('splits prefix, region and number', () => {
    expect(parse('LOB-FR001')).toEqual({ prefix: 'LOB', region: 'FR', number: '001' });
    expect(parse('SDY-046')).toEqual({ prefix: 'SDY', region: '', number: '046' });
    expect(parse('LOB-E001')).toEqual({ prefix: 'LOB', region: 'E', number: '001' });
    expect(parse('DUEA-ENSE1')).toEqual({ prefix: 'DUEA', region: 'EN', number: 'SE1' });
  });
});

describe('languageOf', () => {
  it('maps every known region', () => {
    const table: [string, string][] = [
      ['EN', 'English'], ['E', 'English'], ['', 'English'],
      ['FR', 'French'], ['F', 'French'],
      ['DE', 'German'], ['G', 'German'],
      ['IT', 'Italian'], ['I', 'Italian'],
      ['SP', 'Spanish'], ['S', 'Spanish'],
      ['PT', 'Portuguese'], ['P', 'Portuguese'],
      ['JP', 'Japanese'],
      ['KR', 'Korean'], ['K', 'Korean'],
      ['AE', 'Asian English'],
      ['TC', 'Traditional Chinese'],
      ['SC', 'Simplified Chinese'],
    ];
    for (const [region, language] of table) expect(languageOf(region)).toBe(language);
  });

  it('returns Unknown for anything else', () => {
    expect(languageOf('ZZ')).toBe('Unknown');
    expect(languageOf('EM')).toBe('Unknown');
  });
});

describe('lookupCandidates', () => {
  it('tries the printed code, then EN, then E, then no region', () => {
    expect(lookupCandidates('LOB-FR001')).toEqual(['LOB-FR001', 'LOB-EN001', 'LOB-E001', 'LOB-001']);
  });

  it('removes duplicates', () => {
    expect(lookupCandidates('LOB-EN001')).toEqual(['LOB-EN001', 'LOB-E001', 'LOB-001']);
    expect(lookupCandidates('SDY-046')).toEqual(['SDY-046', 'SDY-EN046', 'SDY-E046']);
  });

  it('adds a variant with misread letters fixed in the number', () => {
    expect(lookupCandidates('LOB-FRO0I')).toEqual([
      'LOB-FRO0I', 'LOB-FR001',
      'LOB-ENO0I', 'LOB-EN001',
      'LOB-EO0I', 'LOB-E001',
      'LOB-O0I', 'LOB-001',
    ]);
  });

  it('leaves special-edition numbers alone', () => {
    expect(lookupCandidates('DUEA-ENSE1')).toEqual(['DUEA-ENSE1', 'DUEA-ESE1', 'DUEA-SE1']);
  });
});

describe('extractAll', () => {
  it('returns every code in the text, in reading order', () => {
    expect(extractAll('ED-ITION 7 LOB-EN001\nxx SDK-001')).toEqual(['ED-ITION', 'LOB-EN001', 'SDK-001']);
  });

  it('finds codes separated by a single character', () => {
    expect(extractAll('LOB-EN001 LOB-EN002')).toEqual(['LOB-EN001', 'LOB-EN002']);
  });

  it('lists a repeated code once', () => {
    expect(extractAll('LOB-EN001 lob-en001')).toEqual(['LOB-EN001']);
  });

  it('returns nothing when there is no code', () => {
    expect(extractAll('HELLO 123')).toEqual([]);
  });
});

describe('readingVariants', () => {
  it('puts the code with look-alike letters turned into digits first', () => {
    expect(readingVariants('LOB-ENOOS')).toEqual(['LOB-EN005', 'LOB-ENOOS']);
    expect(readingVariants('SDK-OI8')).toEqual(['SDK-018', 'SDK-OI8']);
    expect(readingVariants('LOB-FRZBG')).toEqual(['LOB-FR286', 'LOB-FRZBG']);
  });

  it('gives a clean code once', () => {
    expect(readingVariants('LOB-EN001')).toEqual(['LOB-EN001']);
  });

  it('keeps special-edition numbers as the fallback', () => {
    expect(readingVariants('DUEA-ENSE1')).toEqual(['DUEA-EN5E1', 'DUEA-ENSE1']);
  });
});
