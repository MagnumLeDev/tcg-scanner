import { describe, expect, it } from 'vitest';
import { CODE_PATTERN, extract, candidateCodes, languageOf, lookupCandidates, parse } from './setCode';

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

describe('candidateCodes', () => {
  it('gives a cleanly read code first', () => {
    expect(candidateCodes('LOB-EN001')[0]).toBe('LOB-EN001');
    expect(candidateCodes('MRD-F128')[0]).toBe('MRD-F128');
    expect(candidateCodes('SDK-001')[0]).toBe('SDK-001');
  });

  it('tidies case, spaces and dash characters', () => {
    expect(candidateCodes(' lob – en001 ')[0]).toBe('LOB-EN001');
  });

  it('turns letters in the number into the digits they look like', () => {
    expect(candidateCodes('DUDE-FRO14')[0]).toBe('DUDE-FR014');
    expect(candidateCodes('LOB-ENOOS')[0]).toBe('LOB-EN005');
  });

  it('turns digits in the language marker into the letters they look like', () => {
    expect(candidateCodes('SAST-1T033')[0]).toBe('SAST-IT033');
    expect(candidateCodes('LOB-5P001')[0]).toBe('LOB-SP001');
  });

  it('offers nothing when the language marker is not a known one', () => {
    expect(candidateCodes('CYAC-TR017')).toEqual([]);
  });

  it('keeps a number that really contains letters, after the all-digit reading', () => {
    expect(candidateCodes('DUEA-ENSE1')[0]).toBe('DUEA-ENSE1');
    expect(candidateCodes('DUEA-ENSE1')).not.toContain('DUEA-ENSE');
    expect(candidateCodes('LOB-ENO01').slice(0, 2)).toEqual(['LOB-EN001', 'LOB-ENO01']);
  });

  it('copes with stray characters before and after the code', () => {
    expect(candidateCodes('ESAST-IT033')).toContain('SAST-IT033');
    expect(candidateCodes('SDK-001XY')[0]).toBe('SDK-001');
    expect(candidateCodes('x LOB-EN001.')[0]).toBe('LOB-EN001');
  });

  it('prefers the longest prefix', () => {
    const candidates = candidateCodes('ESAST-IT033');
    expect(candidates.indexOf('ESAST-IT033')).toBeLessThan(candidates.indexOf('SAST-IT033'));
  });

  it('also offers look-alike characters swapped in the set prefix, last', () => {
    const candidates = candidateCodes('CTI3-EN003');
    expect(candidates[0]).toBe('CTI3-EN003');
    expect(candidates).toContain('CT13-EN003');
  });

  it('never offers the same code twice', () => {
    const candidates = candidateCodes('LOB-ENOOS');
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('offers nothing for text without a code', () => {
    expect(candidateCodes('HELLO')).toEqual([]);
    expect(candidateCodes('ATK/2500 DEF-2100')).toEqual([]);
    expect(candidateCodes('')).toEqual([]);
  });
});
