import { describe, expect, it } from 'vitest';
import type { Match } from './cardMatch';
import { createDetector } from './detector';

const KNOWN: Record<string, string> = { 'DUEA-ENSE1': 'DUEA-ENSE1', 'LOB-EN001': 'LOB-EN001', 'LOB-FR001': 'LOB-EN001', 'SDK-001': 'SDK-001' };

function find(code: string): Match | null {
  const matchedCode = KNOWN[code];
  if (!matchedCode) return null;
  return { matchedCode, printings: [{ code: matchedCode, name: 'Card', setName: 'Set', rarity: 'Common' }] };
}

describe('createDetector', () => {
  it('reports a known code once it is read twice', () => {
    const detector = createDetector(find);
    expect(detector.feed('LOB-EN001')).toBeNull();
    expect(detector.feed('LOB-EN001')?.code).toBe('LOB-EN001');
  });

  it('still counts when one reading in between misses', () => {
    const detector = createDetector(find);
    detector.feed('LOB-EN001');
    detector.feed('');
    expect(detector.feed('LOB-EN001')?.code).toBe('LOB-EN001');
  });

  it('does not count two readings separated by two misses', () => {
    const detector = createDetector(find);
    detector.feed('LOB-EN001');
    detector.feed('');
    detector.feed('');
    expect(detector.feed('LOB-EN001')).toBeNull();
  });

  it('never reports a code the database does not know', () => {
    const detector = createDetector(find);
    detector.feed('XYZ-EN999');
    expect(detector.feed('XYZ-EN999')).toBeNull();
  });

  it('picks the known code out of surrounding noise', () => {
    const detector = createDetector(find);
    detector.feed('ED-ITION 4 SDK-001 --L');
    expect(detector.feed('T1 SDK-001\nAB-CDE')?.code).toBe('SDK-001');
  });

  it('keeps the printed code and gives the database match', () => {
    const detector = createDetector(find);
    detector.feed('LOB-FR001');
    const detection = detector.feed('LOB-FR001');
    expect(detection?.code).toBe('LOB-FR001');
    expect(detection?.match.matchedCode).toBe('LOB-EN001');
  });

  it('starts counting again after a detection', () => {
    const detector = createDetector(find);
    detector.feed('LOB-EN001');
    detector.feed('LOB-EN001');
    expect(detector.feed('LOB-EN001')).toBeNull();
    expect(detector.feed('LOB-EN001')?.code).toBe('LOB-EN001');
  });

  it('ignores a dismissed code while the card stays in view', () => {
    const detector = createDetector(find);
    detector.feed('LOB-EN001');
    detector.feed('LOB-EN001');
    detector.dismiss('LOB-EN001');
    for (let i = 0; i < 6; i++) expect(detector.feed('LOB-EN001')).toBeNull();
  });

  it('keeps ignoring a dismissed code through a couple of missed readings', () => {
    const detector = createDetector(find);
    detector.dismiss('LOB-EN001');
    detector.feed('');
    detector.feed('');
    detector.feed('LOB-EN001');
    expect(detector.feed('LOB-EN001')).toBeNull();
  });

  it('accepts a dismissed code again once the card has left the view', () => {
    const detector = createDetector(find);
    detector.dismiss('LOB-EN001');
    detector.feed('');
    detector.feed('');
    detector.feed('');
    detector.feed('LOB-EN001');
    expect(detector.feed('LOB-EN001')?.code).toBe('LOB-EN001');
  });

  it('reports another card while one is dismissed', () => {
    const detector = createDetector(find);
    detector.dismiss('LOB-EN001');
    detector.feed('SDK-001');
    expect(detector.feed('SDK-001')?.code).toBe('SDK-001');
  });

  it('reports the code with misread digits put right', () => {
    const detector = createDetector(find);
    detector.feed('LOB-ENOO1');
    expect(detector.feed('LOB-ENOOI')?.code).toBe('LOB-EN001');
  });

  it('counts a misread and a clean reading as the same card', () => {
    const detector = createDetector(find);
    detector.feed('LOB-ENOO1');
    expect(detector.feed('LOB-EN001')?.code).toBe('LOB-EN001');
  });

  it('keeps a code whose number really contains letters', () => {
    const detector = createDetector(find);
    detector.feed('DUEA-ENSE1');
    expect(detector.feed('DUEA-ENSE1')?.code).toBe('DUEA-ENSE1');
  });
});
