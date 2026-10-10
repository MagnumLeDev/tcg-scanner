import { useRef, useState } from 'react';
import { entryKey, type Entry } from '../collection';
import { fromCsv, toCsv } from '../csv';
import { saveTextFile } from '../saveFile';

type Props = {
  entries: Entry[];
  priceLink: (entry: Entry) => string;
  onSetQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onImport: (entries: Entry[], mode: 'merge' | 'replace') => void;
  onGoScan: () => void;
};

type Pending = { entries: Entry[]; skipped: number };

export function CardsScreen({ entries, priceLink, onSetQuantity, onRemove, onImport, onGoScan }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function confirmRemove(entry: Entry) {
    if (window.confirm(`Remove “${entry.name}” (${entry.code}) from your list?`)) onRemove(entryKey(entry));
  }

  function decrease(entry: Entry) {
    if (entry.quantity > 1) onSetQuantity(entryKey(entry), entry.quantity - 1);
    else confirmRemove(entry);
  }

  async function exportCsv() {
    const date = new Date().toISOString().slice(0, 10);
    await saveTextFile(`ygo-cards-${date}.csv`, toCsv(entries), 'text/csv');
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    setPending(null);
    try {
      setPending(fromCsv(await file.text()));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function finishImport(mode: 'merge' | 'replace') {
    if (!pending) return;
    onImport(pending.entries, mode);
    setPending(null);
  }

  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);

  return (
    <div className="pad stack">
      <div className="row">
        <h2 className="grow">
          My cards <span className="muted">· {total}</span>
        </h2>
        <button disabled={entries.length === 0} onClick={() => void exportCsv()}>
          Export CSV
        </button>
        <button onClick={() => fileInput.current?.click()}>Import CSV</button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(event) => void readFile(event.target.files?.[0])}
        />
      </div>

      {importError && <div className="error">{importError}</div>}

      {pending && (
        <section className="card stack">
          <div>
            The file contains {pending.entries.length} card{pending.entries.length === 1 ? '' : 's'}.
            {pending.skipped > 0 && ` ${pending.skipped} unreadable row${pending.skipped === 1 ? ' was' : 's were'} skipped.`}
          </div>
          <div className="row wrap">
            <button className="primary" disabled={pending.entries.length === 0} onClick={() => finishImport('merge')}>
              Merge into my list
            </button>
            <button
              className="danger"
              disabled={pending.entries.length === 0}
              onClick={() => finishImport('replace')}
            >
              Replace my list
            </button>
            <button onClick={() => setPending(null)}>Cancel</button>
          </div>
        </section>
      )}

      {entries.length === 0 && (
        <div className="stack">
          <p className="muted">No cards yet. Scan a card to add it here.</p>
          <button className="primary" onClick={onGoScan}>
            Scan a card
          </button>
        </div>
      )}

      {entries.map((entry) => (
        <section className="card" key={entryKey(entry)}>
          <div className="row">
            <div className="grow">
              <strong>{entry.name}</strong>
              <div className="muted">
                {entry.code} · {entry.language} · {entry.rarity}
              </div>
              <div className="muted">{entry.setName}</div>
              <a className="link" href={priceLink(entry)} target="_blank" rel="noopener noreferrer">
                Price on Cardmarket
              </a>
            </div>
            <div className="quantity">
              <button aria-label="One fewer" onClick={() => decrease(entry)}>
                −
              </button>
              <span>{entry.quantity}</span>
              <button aria-label="One more" onClick={() => onSetQuantity(entryKey(entry), entry.quantity + 1)}>
                +
              </button>
            </div>
            <button className="danger" aria-label="Remove" onClick={() => confirmRemove(entry)}>
              ✕
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
