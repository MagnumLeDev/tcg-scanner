import { useEffect, useState } from 'react';
import type { CardDatabase } from '../cardDatabase';
import type { NewEntry } from '../collection';
import { prepare, recognise } from '../ocr/ocr';
import { extract } from '../setCode';
import { CameraView } from './CameraView';
import { ResultPanel } from './ResultPanel';

type Props = {
  db: CardDatabase;
  onAdd: (entry: NewEntry) => void;
  onOpenSettings: () => void;
};

type Reading = { id: number; code: string; hint: string | null };

const NO_CODE = 'No code found — move closer and retry, or type the code.';

export function ScanScreen({ db, onAdd, onOpenSettings }: Props) {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [manualId, setManualId] = useState(0);
  const [reader, setReader] = useState<'loading' | 'ready' | 'failed'>('loading');
  const hasData = db.hasData();

  // Fetch the text reader as soon as the screen opens, not on the first scan,
  // so that the first scan is quick and scanning works offline afterwards.
  useEffect(() => {
    if (!hasData) return;
    let active = true;
    prepare().then(
      () => active && setReader('ready'),
      () => active && setReader('failed'),
    );
    return () => {
      active = false;
    };
  }, [hasData]);

  if (!hasData) {
    return (
      <div className="pad stack">
        <p>To identify cards, subscribe to a card database first. It is downloaded once and then works offline.</p>
        <button className="primary" onClick={onOpenSettings}>
          Open Settings
        </button>
      </div>
    );
  }

  async function handleCapture(canvas: HTMLCanvasElement) {
    setBusy(true);
    try {
      const raw = await recognise(canvas);
      const code = extract(raw);
      setReading({ id: Date.now(), code: code ?? raw.trim(), hint: code ? null : NO_CODE });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setReading({ id: Date.now(), code: '', hint: `Reading failed (${detail}). Type the code instead.` });
    } finally {
      setBusy(false);
    }
  }

  if (cameraError) {
    return (
      <div className="stack">
        <p className="pad error">{cameraError}</p>
        <ResultPanel
          key={manualId}
          db={db}
          initialCode=""
          hint="You can still add cards by typing their set code."
          onAdd={(entry) => {
            onAdd(entry);
            setManualId((id) => id + 1);
          }}
          onClose={null}
        />
      </div>
    );
  }

  return (
    <div className="scan">
      <CameraView busy={busy || reader === 'loading'} onCapture={handleCapture} onError={setCameraError} />
      {!reading && reader === 'loading' && (
        <p className="pad muted">Getting the text reader ready. This download happens once.</p>
      )}
      {!reading && reader === 'failed' && (
        <p className="pad error">The text reader could not be downloaded. Connect to the internet, then tap Scan.</p>
      )}
      {reading && (
        <ResultPanel
          key={reading.id}
          db={db}
          initialCode={reading.code}
          hint={reading.hint}
          onAdd={(entry) => {
            onAdd(entry);
            setReading(null);
          }}
          onClose={() => setReading(null)}
        />
      )}
    </div>
  );
}
