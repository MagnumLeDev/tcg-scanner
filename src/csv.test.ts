import { describe, expect, it } from 'vitest';
import type { Entry } from './collection';
import { fromCsv, toCsv } from './csv';

const HEADER = 'code,matched_code,language,name,set_name,rarity,quantity,added_at';

const BEWD: Entry = {
  code: 'LOB-FR001',
  matchedCode: 'LOB-EN001',
  language: 'French',
  name: 'Blue-Eyes White Dragon',
  setName: 'Legend of Blue Eyes White Dragon',
  rarity: 'Ultra Rare',
  quantity: 2,
  addedAt: '2026-10-09T12:00:00.000Z',
};

const TRICKY: Entry = {
  code: 'MP19-EN001',
  matchedCode: 'MP19-EN001',
  language: 'English',
  name: 'Ib the World Chalice "Justiciar", Reborn',
  setName: 'Line one\nLine two; with semicolon',
  rarity: 'Common',
  quantity: 1,
  addedAt: '2026-10-09T12:00:01.000Z',
};

describe('toCsv', () => {
  it('writes a header and one line per entry', () => {
    expect(toCsv([BEWD])).toBe(
      `${HEADER}\r\nLOB-FR001,LOB-EN001,French,Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,Ultra Rare,2,2026-10-09T12:00:00.000Z\r\n`,
    );
  });

  it('writes only the header for an empty list', () => {
    expect(toCsv([])).toBe(`${HEADER}\r\n`);
  });

  it('quotes fields containing commas, quotes, semicolons or newlines', () => {
    const csv = toCsv([TRICKY]);
    expect(csv).toContain('"Ib the World Chalice ""Justiciar"", Reborn"');
    expect(csv).toContain('"Line one\nLine two; with semicolon"');
  });
});

describe('fromCsv', () => {
  it('round-trips entries, including tricky text', () => {
    expect(fromCsv(toCsv([BEWD, TRICKY]))).toEqual({ entries: [BEWD, TRICKY], skipped: 0 });
  });

  it('reads an empty list', () => {
    expect(fromCsv(toCsv([]))).toEqual({ entries: [], skipped: 0 });
  });

  it('reads a file re-saved by Excel: byte-order mark, CRLF, semicolons', () => {
    const excel =
      '﻿code;matched_code;language;name;set_name;rarity;quantity;added_at\r\n' +
      'LOB-FR001;LOB-EN001;French;Blue-Eyes White Dragon;Legend of Blue Eyes White Dragon;Ultra Rare;2;2026-10-09T12:00:00.000Z\r\n';
    expect(fromCsv(excel)).toEqual({ entries: [BEWD], skipped: 0 });
  });

  it('reads LF line ends and a file without a final newline', () => {
    const text = `${HEADER}\nLOB-FR001,LOB-EN001,French,Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,Ultra Rare,2,2026-10-09T12:00:00.000Z`;
    expect(fromCsv(text).entries).toEqual([BEWD]);
  });

  it('ignores blank lines and tolerates header case and spaces', () => {
    const text = `Code, Matched_Code, Language, Name, Set_Name, Rarity, Quantity, Added_At\r\n\r\nLOB-FR001,LOB-EN001,French,Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,Ultra Rare,2,2026-10-09T12:00:00.000Z\r\n\r\n`;
    expect(fromCsv(text)).toEqual({ entries: [BEWD], skipped: 0 });
  });

  it('skips malformed rows and counts them', () => {
    const rows = [
      HEADER,
      'LOB-FR001,LOB-EN001,French,Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,Ultra Rare,2,2026-10-09T12:00:00.000Z',
      'too,few,fields',
      'LOB-FR001,LOB-EN001,French,Name,Set,Ultra Rare,zero,2026-10-09T12:00:00.000Z',
      'LOB-FR001,LOB-EN001,French,Name,Set,Ultra Rare,0,2026-10-09T12:00:00.000Z',
      'LOB-FR001,LOB-EN001,French,Name,Set,Ultra Rare,1.5,2026-10-09T12:00:00.000Z',
      'LOB-FR001,LOB-EN001,Klingon,Name,Set,Ultra Rare,1,2026-10-09T12:00:00.000Z',
      'not a code,LOB-EN001,French,Name,Set,Ultra Rare,1,2026-10-09T12:00:00.000Z',
    ];
    expect(fromCsv(rows.join('\r\n'))).toEqual({ entries: [BEWD], skipped: 6 });
  });

  it('combines repeated rows for the same card', () => {
    const line = 'LOB-FR001,LOB-EN001,French,Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,Ultra Rare,2,2026-10-09T12:00:00.000Z';
    expect(fromCsv([HEADER, line, line].join('\r\n')).entries).toEqual([{ ...BEWD, quantity: 4 }]);
  });

  it('rejects a file with the wrong header', () => {
    expect(() => fromCsv('name,price\r\nA,1\r\n')).toThrow(/not a YGO Scanner card list/i);
    expect(() => fromCsv('')).toThrow(/not a YGO Scanner card list/i);
  });
});
