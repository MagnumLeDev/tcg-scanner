import { entryKey, isEntry, type Entry } from './collection';

const HEADER = ['code', 'matched_code', 'language', 'name', 'set_name', 'rarity', 'quantity', 'added_at'];

function quote(value: string): string {
  return /[",;\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(entries: Entry[]): string {
  const lines = [HEADER.join(',')];
  for (const e of entries) {
    lines.push(
      [e.code, e.matchedCode, e.language, e.name, e.setName, e.rarity, String(e.quantity), e.addedAt]
        .map(quote)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function fromCsv(text: string): { entries: Entry[]; skipped: number } {
  const body = text.replace(/^﻿/, '');
  const firstLine = body.split('\n', 1)[0];
  // Excel on systems with a decimal comma saves "CSV" with semicolons.
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';

  const rows = parseRows(body, delimiter);
  const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase());
  if (header.length !== HEADER.length || header.some((cell, i) => cell !== HEADER[i])) {
    throw new Error('This file is not a YGO Scanner card list.');
  }

  const byKey = new Map<string, Entry>();
  let skipped = 0;
  for (const row of rows.slice(1)) {
    if (row.length === 1 && row[0].trim() === '') continue;
    const candidate: unknown =
      row.length === HEADER.length
        ? {
            code: row[0].trim(),
            matchedCode: row[1].trim(),
            language: row[2].trim(),
            name: row[3],
            setName: row[4],
            rarity: row[5],
            quantity: Number(row[6]),
            addedAt: row[7].trim(),
          }
        : null;
    if (!isEntry(candidate)) {
      skipped++;
      continue;
    }
    const key = entryKey(candidate);
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, quantity: existing.quantity + candidate.quantity } : candidate);
  }
  return { entries: [...byKey.values()], skipped };
}
