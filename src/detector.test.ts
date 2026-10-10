import { describe, expect, it } from 'vitest';
import type { Match } from './cardMatch';
import { createDetector } from './detector';

const KNOWN: Record<string, string> = { 'DUEA-ENSE1': 'DUEA-ENSE1', 'LOB-EN001': 'LOB-EN001', 'LOB-FR001': 'LOB-EN001', 'SDK-001': 'SDK-001' };

function find(code: string): Match | null {
  const matchedCode = KNOWN[code];
  if (!matchedCode) return null;
  return { matchedCode, printings: [{ code: matchedCode, cardId: 1, name: 'Card', setName: 'Set', rarity: 'Common' }] };
}

// Lines read with too little confidence to be trusted on a single reading.
const unsure = (text: string) => text.split('\n').map((line) => ({ text: line, confidence: 0.5 }));
const sure = (text: string) => [{ text, confidence: 0.95 }];

describe('createDetector', () => {
  it('reports a confidently read code at once', () => {
    const detector = createDetector(find);
    expect(detector.feed(sure('LOB-EN001'))?.code).toBe('LOB-EN001');
  });

  it('does not report a confidently read code the database does not know', () => {
    const detector = createDetector(find);
    expect(detector.feed(sure('XYZ-EN999'))).toBeNull();
  });

  it('ignores a dismissed code even when read confidently', () => {
    const detector = createDetector(find);
    detector.dismiss('LOB-EN001');
    expect(detector.feed(sure('LOB-EN001'))).toBeNull();
  });

  it('reports a known code once it is read twice', () => {
    const detector = createDetector(find);
    expect(detector.feed(unsure('LOB-EN001'))).toBeNull();
    expect(detector.feed(unsure('LOB-EN001'))?.code).toBe('LOB-EN001');
  });

  it('still counts when one reading in between misses', () => {
    const detector = createDetector(find);
    detector.feed(unsure('LOB-EN001'));
    detector.feed(unsure(''));
    expect(detector.feed(unsure('LOB-EN001'))?.code).toBe('LOB-EN001');
  });

  it('does not count two readings separated by two misses', () => {
    const detector = createDetector(find);
    detector.feed(unsure('LOB-EN001'));
    detector.feed(unsure(''));
    detector.feed(unsure(''));
    expect(detector.feed(unsure('LOB-EN001'))).toBeNull();
  });

  it('never reports a code the database does not know', () => {
    const detector = createDetector(find);
    detector.feed(unsure('XYZ-EN999'));
    expect(detector.feed(unsure('XYZ-EN999'))).toBeNull();
  });

  it('picks the known code out of surrounding noise', () => {
    const detector = createDetector(find);
    detector.feed(unsure('ED-ITION\nSDK-001\n--L'));
    expect(detector.feed(unsure('T1\nSDK-001\nAB-CDE'))?.code).toBe('SDK-001');
  });

  it('keeps the printed code and gives the database match', () => {
    const detector = createDetector(find);
    detector.feed(unsure('LOB-FR001'));
    const detection = detector.feed(unsure('LOB-FR001'));
    expect(detection?.code).toBe('LOB-FR001');
    expect(detection?.match.matchedCode).toBe('LOB-EN001');
  });

  it('starts counting again after a detection', () => {
    const detector = createDetector(find);
    detector.feed(unsure('LOB-EN001'));
    detector.feed(unsure('LOB-EN001'));
    expect(detector.feed(unsure('LOB-EN001'))).toBeNull();
    expect(detector.feed(unsure('LOB-EN001'))?.code).toBe('LOB-EN001');
  });

  it('ignores a dismissed code while the card stays in view', () => {
    const detector = createDetector(find);
    detector.feed(unsure('LOB-EN001'));
    detector.feed(unsure('LOB-EN001'));
    detector.dismiss('LOB-EN001');
    for (let i = 0; i < 6; i++) expect(detector.feed(unsure('LOB-EN001'))).toBeNull();
  });

  it('keeps ignoring a dismissed code through a couple of missed readings', () => {
    const detector = createDetector(find);
    detector.dismiss('LOB-EN001');
    detector.feed(unsure(''));
    detector.feed(unsure(''));
    detector.feed(unsure('LOB-EN001'));
    expect(detector.feed(unsure('LOB-EN001'))).toBeNull();
  });

  it('accepts a dismissed code again once the card has left the view', () => {
    const detector = createDetector(find);
    detector.dismiss('LOB-EN001');
    detector.feed(unsure(''));
    detector.feed(unsure(''));
    detector.feed(unsure(''));
    detector.feed(unsure('LOB-EN001'));
    expect(detector.feed(unsure('LOB-EN001'))?.code).toBe('LOB-EN001');
  });

  it('reports another card while one is dismissed', () => {
    const detector = createDetector(find);
    detector.dismiss('LOB-EN001');
    detector.feed(unsure('SDK-001'));
    expect(detector.feed(unsure('SDK-001'))?.code).toBe('SDK-001');
  });

  it('reports the code with misread digits put right', () => {
    const detector = createDetector(find);
    detector.feed(unsure('LOB-ENOO1'));
    expect(detector.feed(unsure('LOB-ENOOI'))?.code).toBe('LOB-EN001');
  });

  it('counts a misread and a clean reading as the same card', () => {
    const detector = createDetector(find);
    detector.feed(unsure('LOB-ENOO1'));
    expect(detector.feed(unsure('LOB-EN001'))?.code).toBe('LOB-EN001');
  });

  it('keeps a code whose number really contains letters', () => {
    const detector = createDetector(find);
    detector.feed(unsure('DUEA-ENSE1'));
    expect(detector.feed(unsure('DUEA-ENSE1'))?.code).toBe('DUEA-ENSE1');
  });
});
