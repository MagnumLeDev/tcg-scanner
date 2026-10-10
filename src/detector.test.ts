import { describe, expect, it } from 'vitest';
import type { Match } from './cardMatch';
import { createDetector, inOneLanguage, type Cards, type Detection } from './detector';
import type { NameMatch } from './nameIndex';
import type { Line } from './ocr/decode';
import type { Printing } from './sources/types';

// Card 1 is printed as LOB-EN001 and SDK-001, card 2 as LOB-EN002, card 3 as DUEA-ENSE1.
const PRINTINGS: Printing[] = [
  { code: 'LOB-EN001', cardId: 1, name: 'Blue-Eyes White Dragon', setName: 'LOB', rarity: 'Ultra Rare' },
  { code: 'SDK-001', cardId: 1, name: 'Blue-Eyes White Dragon', setName: 'SDK', rarity: 'Ultra Rare' },
  { code: 'LOB-EN002', cardId: 2, name: 'Hitotsu-Me Giant', setName: 'LOB', rarity: 'Common' },
  { code: 'DUEA-ENSE1', cardId: 3, name: 'Special', setName: 'DUEA', rarity: 'Super Rare' },
];
const NAMES: Record<string, NameMatch> = {
  'DRAGON BLANC AUX YEUX BLEUS': { cardId: 1, name: 'Dragon Blanc aux Yeux Bleus', language: 'French', score: 1 },
  'HITOTSU-ME GIANT': { cardId: 2, name: 'Hitotsu-Me Giant', language: 'English', score: 1 },
};

function cards(printings: Printing[] = PRINTINGS): Cards {
  return {
    // French codes resolve to the English entry, as match() does.
    find(code): Match | null {
      const matchedCode = code.replace('-FR', '-EN');
      const found = printings.filter((p) => p.code === matchedCode);
      return found.length > 0 ? { matchedCode, printings: found } : null;
    },
    findByName: (text) => NAMES[text] ?? null,
    printingsOf: (cardId) => printings.filter((p) => p.cardId === cardId),
  };
}

// Lines read with too little confidence to be trusted on a single reading.
const unsure = (text: string): Line[] => text.split('\n').map((line) => ({ text: line, confidence: 0.5 }));
const sure = (text: string): Line[] => [{ text, confidence: 0.95 }];
// A whole-picture reading unless said otherwise; close-ups never carry a name.
const read = (codes: Line[], name = '', whole = true) => ({ codes, names: name ? [{ text: name, confidence: 0.6 }] : [], whole });
const closeUp = (codes: Line[] = []) => read(codes, '', false);
const nothing = read([]);

const codeOf = (detection: Detection | null) => (detection?.kind === 'code' ? detection.code : null);
const cardOf = (detection: Detection | null) => (detection?.kind === 'card' ? detection.cardId : null);
const BLUE_EYES = 'DRAGON BLANC AUX YEUX BLEUS';

describe('createDetector', () => {
  it('reports a confidently read code at once', () => {
    const detector = createDetector(cards());
    expect(codeOf(detector.feed(read(sure('LOB-EN001'))))).toBe('LOB-EN001');
  });

  it('does not report a confidently read code the database does not know', () => {
    const detector = createDetector(cards());
    expect(detector.feed(read(sure('XYZ-EN999')))).toBeNull();
  });

  it('ignores a dismissed code even when read confidently', () => {
    const detector = createDetector(cards());
    detector.dismiss({ kind: 'code', code: 'LOB-EN001', match: cards().find('LOB-EN001')! });
    expect(detector.feed(read(sure('LOB-EN001')))).toBeNull();
  });

  it('reports a known code once it is read twice', () => {
    const detector = createDetector(cards());
    expect(detector.feed(read(unsure('LOB-EN001')))).toBeNull();
    expect(codeOf(detector.feed(read(unsure('LOB-EN001'))))).toBe('LOB-EN001');
  });

  it('still counts when one reading in between misses', () => {
    const detector = createDetector(cards());
    detector.feed(read(unsure('LOB-EN001')));
    detector.feed(read(unsure('')));
    expect(codeOf(detector.feed(read(unsure('LOB-EN001'))))).toBe('LOB-EN001');
  });

  it('does not count two readings separated by two misses', () => {
    const detector = createDetector(cards());
    detector.feed(read(unsure('LOB-EN001')));
    detector.feed(read(unsure('')));
    detector.feed(read(unsure('')));
    expect(detector.feed(read(unsure('LOB-EN001')))).toBeNull();
  });

  it('never reports a code the database does not know', () => {
    const detector = createDetector(cards());
    detector.feed(read(unsure('XYZ-EN999')));
    expect(detector.feed(read(unsure('XYZ-EN999')))).toBeNull();
  });

  it('picks the known code out of surrounding noise', () => {
    const detector = createDetector(cards());
    detector.feed(read(unsure('ED-ITION\nSDK-001\n--L')));
    expect(codeOf(detector.feed(read(unsure('T1\nSDK-001\nAB-CDE'))))).toBe('SDK-001');
  });

  it('keeps the printed code and gives the database match', () => {
    const detector = createDetector(cards());
    detector.feed(read(unsure('LOB-FR001')));
    const detection = detector.feed(read(unsure('LOB-FR001')));
    expect(codeOf(detection)).toBe('LOB-FR001');
    expect(detection?.kind === 'code' && detection.match.matchedCode).toBe('LOB-EN001');
  });

  it('starts counting again after a detection', () => {
    const detector = createDetector(cards());
    detector.feed(read(unsure('LOB-EN001')));
    detector.feed(read(unsure('LOB-EN001')));
    expect(detector.feed(read(unsure('LOB-EN001')))).toBeNull();
    expect(codeOf(detector.feed(read(unsure('LOB-EN001'))))).toBe('LOB-EN001');
  });

  it('ignores a dismissed code while the card stays in view', () => {
    const detector = createDetector(cards());
    detector.feed(read(unsure('LOB-EN001')));
    detector.feed(read(unsure('LOB-EN001')));
    detector.dismiss({ kind: 'code', code: 'LOB-EN001', match: cards().find('LOB-EN001')! });
    for (let i = 0; i < 6; i++) expect(detector.feed(read(unsure('LOB-EN001')))).toBeNull();
  });

  it('keeps ignoring a dismissed code through a couple of missed readings', () => {
    const detector = createDetector(cards());
    detector.dismiss({ kind: 'code', code: 'LOB-EN001', match: cards().find('LOB-EN001')! });
    detector.feed(read(unsure('')));
    detector.feed(read(unsure('')));
    detector.feed(read(unsure('LOB-EN001')));
    expect(detector.feed(read(unsure('LOB-EN001')))).toBeNull();
  });

  it('accepts a dismissed code again once the card has left the view', () => {
    const detector = createDetector(cards());
    detector.dismiss({ kind: 'code', code: 'LOB-EN001', match: cards().find('LOB-EN001')! });
    detector.feed(read(unsure('')));
    detector.feed(read(unsure('')));
    detector.feed(read(unsure('')));
    detector.feed(read(unsure('LOB-EN001')));
    expect(codeOf(detector.feed(read(unsure('LOB-EN001'))))).toBe('LOB-EN001');
  });

  it('reports another card while one is dismissed', () => {
    const detector = createDetector(cards());
    detector.dismiss({ kind: 'code', code: 'LOB-EN001', match: cards().find('LOB-EN001')! });
    detector.feed(read(unsure('LOB-EN002')));
    expect(codeOf(detector.feed(read(unsure('LOB-EN002'))))).toBe('LOB-EN002');
  });

  it('reports the code with misread digits put right', () => {
    const detector = createDetector(cards());
    detector.feed(read(unsure('LOB-ENOO1')));
    expect(codeOf(detector.feed(read(unsure('LOB-ENOOI'))))).toBe('LOB-EN001');
  });

  it('counts a misread and a clean reading as the same card', () => {
    const detector = createDetector(cards());
    detector.feed(read(unsure('LOB-ENOO1')));
    expect(codeOf(detector.feed(read(unsure('LOB-EN001'))))).toBe('LOB-EN001');
  });

  it('keeps a code whose number really contains letters', () => {
    const detector = createDetector(cards());
    detector.feed(read(unsure('DUEA-ENSE1')));
    expect(codeOf(detector.feed(read(unsure('DUEA-ENSE1'))))).toBe('DUEA-ENSE1');
  });

  describe('with the card name', () => {
    it('accepts an unsure code at once when the name read is that card', () => {
      const detector = createDetector(cards());
      expect(codeOf(detector.feed(read(unsure('LOB-FR001'), BLUE_EYES)))).toBe('LOB-FR001');
    });

    it('remembers the name for the next reading', () => {
      const detector = createDetector(cards());
      expect(detector.feed(read([], BLUE_EYES))).toBeNull();
      expect(codeOf(detector.feed(read(unsure('LOB-FR001'))))).toBe('LOB-FR001');
    });

    it('forgets the name after three readings', () => {
      const detector = createDetector(cards());
      detector.feed(read([], BLUE_EYES));
      detector.feed(nothing);
      detector.feed(nothing);
      expect(detector.feed(read(unsure('LOB-FR001')))).toBeNull();
    });

    it('corrects a code one character off to the named card', () => {
      const detector = createDetector(cards());
      // LOB-FR007 does not exist; the named card is LOB-..001.
      expect(codeOf(detector.feed(read(unsure('LOB-FR007'), BLUE_EYES)))).toBe('LOB-FR001');
    });

    it('corrects an existing code to the named card when they are one character apart', () => {
      const detector = createDetector(cards());
      // LOB-FR002 is card 2, but the name says card 1, printed as LOB-..001.
      const detection = detector.feed(read(sure('LOB-FR002'), BLUE_EYES));
      expect(codeOf(detection)).toBe('LOB-FR001');
      expect(detection?.kind === 'code' && detection.match.printings[0].cardId).toBe(1);
    });

    it('keeps the language marker that was read when correcting', () => {
      const detector = createDetector(cards());
      expect(codeOf(detector.feed(read(unsure('LOB-EN007'), BLUE_EYES)))).toBe('LOB-EN001');
    });

    it('does not correct a code two characters off', () => {
      const detector = createDetector(cards());
      expect(detector.feed(read(unsure('LOB-FR077'), BLUE_EYES))).toBeNull();
    });

    it('does not trust a sure code on one reading when the name says another, unrelated card', () => {
      const detector = createDetector(cards());
      // DUEA-ENSE1 is card 3; the name says card 1, which has no code near it.
      expect(detector.feed(read(sure('DUEA-ENSE1'), BLUE_EYES))).toBeNull();
      expect(codeOf(detector.feed(read(sure('DUEA-ENSE1'))))).toBe('DUEA-ENSE1');
    });

    it('ignores a name that matches nothing', () => {
      const detector = createDetector(cards());
      expect(detector.feed(read([], '[CARTE MAGIE]'))).toBeNull();
      expect(detector.feed(read([], '[CARTE MAGIE]'))).toBeNull();
      expect(codeOf(detector.feed(read(sure('LOB-EN001'), '[CARTE MAGIE]')))).toBe('LOB-EN001');
    });

    it('reports the card when its name is read twice and no code is', () => {
      const detector = createDetector(cards());
      expect(detector.feed(read([], BLUE_EYES))).toBeNull();
      expect(detector.feed(nothing)).toBeNull();
      const detection = detector.feed(read([], BLUE_EYES));
      expect(detection).toEqual({ kind: 'card', cardId: 1, name: 'Dragon Blanc aux Yeux Bleus', language: 'French' });
    });

    it('does not report a card for one name reading, nor for two different names', () => {
      const detector = createDetector(cards());
      expect(detector.feed(read([], BLUE_EYES))).toBeNull();
      expect(detector.feed(read([], 'HITOTSU-ME GIANT'))).toBeNull();
    });

    it('does not report a card by name while a code is being read', () => {
      const detector = createDetector(cards());
      detector.feed(read([], BLUE_EYES));
      expect(cardOf(detector.feed(read(unsure('DUEA-ENSE1'), BLUE_EYES)))).toBeNull();
    });

    it('does not reopen a dismissed card by its name', () => {
      const detector = createDetector(cards());
      const detection = detector.feed(read(sure('LOB-EN001')))!;
      detector.dismiss(detection);
      for (let i = 0; i < 6; i++) expect(detector.feed(read(i % 2 ? [] : sure('LOB-EN001'), i % 2 ? '' : BLUE_EYES))).toBeNull();
    });

    it('does not reopen a card dismissed by name through its code', () => {
      const detector = createDetector(cards());
      detector.feed(read([], BLUE_EYES));
      detector.feed(nothing);
      detector.dismiss(detector.feed(read([], BLUE_EYES))!);
      expect(detector.feed(read(sure('SDK-001'), BLUE_EYES))).toBeNull();
    });

    it('releases a card dismissed by name once it has left the view', () => {
      const detector = createDetector(cards());
      detector.dismiss({ kind: 'card', cardId: 1, name: 'x', language: 'French' });
      detector.feed(nothing);
      detector.feed(nothing);
      detector.feed(nothing);
      expect(codeOf(detector.feed(read(sure('LOB-EN001'))))).toBe('LOB-EN001');
    });
  });

  describe('review fixes', () => {
    it('does not correct a confidently read existing code from a name read earlier', () => {
      const detector = createDetector(cards());
      // The name of card 1 is read, then the card is swapped for card 2 of the same set.
      detector.feed(read([], BLUE_EYES));
      expect(detector.feed(closeUp(sure('LOB-FR002')))).toBeNull();
      expect(codeOf(detector.feed(read(sure('LOB-FR002'), 'HITOTSU-ME GIANT')))).toBe('LOB-FR002');
    });

    it('does not correct an unsure existing code from a name read earlier either', () => {
      const detector = createDetector(cards());
      detector.feed(read([], BLUE_EYES));
      expect(detector.feed(closeUp(unsure('LOB-FR002')))).toBeNull();
    });

    it('reports another printing of a card dismissed through its code at once', () => {
      const detector = createDetector(cards());
      detector.dismiss(detector.feed(read(sure('LOB-EN001'), BLUE_EYES))!);
      expect(codeOf(detector.feed(read(sure('SDK-001'), BLUE_EYES)))).toBe('SDK-001');
    });

    it('keeps a corrected code dismissed while its card stays in view', () => {
      const detector = createDetector(cards());
      detector.dismiss(detector.feed(read(unsure('LOB-FR007'), BLUE_EYES))!);
      for (let i = 0; i < 8; i++) expect(detector.feed(read(unsure('LOB-FR007'), BLUE_EYES))).toBeNull();
    });

    it('keeps a card dismissed by name through one missed name reading', () => {
      const detector = createDetector(cards());
      detector.dismiss({ kind: 'card', cardId: 1, name: 'x', language: 'French' });
      const readings = [read([], BLUE_EYES), closeUp(), nothing, closeUp(), read([], BLUE_EYES), closeUp(), read([], BLUE_EYES), closeUp(), read([], BLUE_EYES)];
      for (const reading of readings) expect(detector.feed(reading)).toBeNull();
    });

    it('releases a card dismissed by name after two whole-picture readings without it', () => {
      const detector = createDetector(cards());
      detector.dismiss({ kind: 'card', cardId: 1, name: 'x', language: 'French' });
      for (const reading of [nothing, closeUp(), nothing, closeUp()]) detector.feed(reading);
      detector.feed(read([], BLUE_EYES));
      detector.feed(closeUp());
      expect(cardOf(detector.feed(read([], BLUE_EYES)))).toBe(1);
    });
  });

  describe('old data without card ids', () => {
    const old = PRINTINGS.map((p) => ({ ...p, cardId: 0 }));

    it('still reports codes', () => {
      const detector = createDetector(cards(old));
      expect(codeOf(detector.feed(read(sure('LOB-EN001'))))).toBe('LOB-EN001');
    });

    it('dismissing one code does not block the others', () => {
      const detector = createDetector(cards(old));
      detector.dismiss(detector.feed(read(sure('LOB-EN001')))!);
      expect(codeOf(detector.feed(read(sure('DUEA-ENSE1'))))).toBe('DUEA-ENSE1');
    });
  });
});

describe('scanning in one language', () => {
  // Names are looked up in the language asked for, as the card database does.
  const french = (language: 'French' | 'English') =>
    inOneLanguage({ ...cards(), findByName: (text, asked) => (NAMES[text]?.language === asked ? NAMES[text] : null) }, language);

  it('accepts a code printed in that language', () => {
    const detector = createDetector(french('French'));
    expect(detector.feed(read(sure('LOB-FR001')))).toMatchObject({ kind: 'code', code: 'LOB-FR001' });
  });

  it('ignores a code printed in another language', () => {
    const detector = createDetector(french('French'));
    expect(detector.feed(read(sure('LOB-EN001')))).toBeNull();
    expect(detector.feed(read(sure('LOB-EN001')))).toBeNull();
  });

  it('accepts a code that has no language marker', () => {
    const detector = createDetector(french('French'));
    expect(detector.feed(read(sure('SDK-001')))).toMatchObject({ kind: 'code', code: 'SDK-001' });
  });

  it('recognises names in that language only', () => {
    const detector = createDetector(french('English'));
    detector.feed(read([], 'DRAGON BLANC AUX YEUX BLEUS'));
    expect(detector.feed(read([], 'DRAGON BLANC AUX YEUX BLEUS'))).toBeNull();
    detector.feed(read([], 'HITOTSU-ME GIANT'));
    expect(detector.feed(read([], 'HITOTSU-ME GIANT'))).toMatchObject({ kind: 'card', cardId: 2 });
  });
});
