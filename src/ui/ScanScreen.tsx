import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardDatabase } from '../cardDatabase';
import { match } from '../cardMatch';
import type { NewEntry } from '../collection';
import { createDetector } from '../detector';
import { pictureLastRead, prepare, recognise } from '../ocr/ocr';
import { sampleFileName } from '../sample';
import { saveFile } from '../saveFile';
import { CameraView } from './CameraView';
import { ResultPanel } from './ResultPanel';

type Props = {
  db: CardDatabase;
  onAdd: (entry: NewEntry) => void;
  onOpenSettings: () => void;
};

// A card the camera found (detected) or a code the user is typing (not detected).
type Reading = { id: number; code: string; detected: boolean };

// What the text reader was given and what it read, shown on request to help
// work out why a card is not recognised.
type Details = { text: string; picture: string | null; milliseconds: number };

export function ScanScreen({ db, onAdd, onOpenSettings }: Props) {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [manualId, setManualId] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const lastCrop = useRef<HTMLCanvasElement | null>(null); // what the camera last captured, untouched
  const [reader, setReader] = useState<'loading' | 'ready' | 'failed'>('loading');
  const hasData = db.hasData();
  const detector = useMemo(() => createDetector((code) => match(db, code)), [db]);

  // Fetch the text reader as soon as the screen opens, so that scanning starts
  // quickly and works offline afterwards.
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

  async function handleFrame(canvas: HTMLCanvasElement) {
    lastCrop.current = canvas;
    const started = performance.now();
    const text = await recognise(canvas);
    if (showDetails) {
      setDetails({
        text: text.replace(/\s+/g, ' ').trim(),
        picture: pictureLastRead()?.toDataURL('image/png') ?? null,
        milliseconds: Math.round(performance.now() - started),
      });
    }
    const detection = detector.feed(text);
    if (!detection) return;
    navigator.vibrate?.(60);
    setReading({ id: Date.now(), code: detection.code, detected: true });
  }

  // Saves what the camera captured, named after the code the user reads on the
  // card, so that cards the reader gets wrong can be collected and studied.
  function savePicture() {
    const crop = lastCrop.current;
    if (!crop) return;
    const typed = window.prompt('Code printed on the card (leave empty if you cannot read it)');
    if (typed === null) return;
    crop.toBlob((blob) => {
      if (blob) void saveFile(new File([blob], sampleFileName(typed, new Date()), { type: 'image/png' }), true);
    }, 'image/png');
  }

  // The card is usually still in front of the camera when the panel closes, so
  // its code is set aside until the card has been taken away.
  function close(current: Reading) {
    if (current.detected) detector.dismiss(current.code);
    setReading(null);
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
      <CameraView paused={reading !== null || reader !== 'ready'} onFrame={handleFrame} onError={setCameraError} />

      {!reading && (
        <div className="scan-status">
          {reader === 'loading' && <p>Getting the text reader ready. This download happens once.</p>}
          {reader === 'failed' && (
            <p className="error">The text reader could not be downloaded. Connect to the internet and reopen the app.</p>
          )}
          {reader === 'ready' && <p>Hold a card inside the outline</p>}
          <div className="row">
            <button onClick={() => setReading({ id: Date.now(), code: '', detected: false })}>Type the code</button>
            <button onClick={() => setShowDetails((shown) => !shown)}>{showDetails ? 'Hide details' : 'Details'}</button>
          </div>
        </div>
      )}

      {showDetails && !reading && (
        <div className="scan-details">
          {details?.picture && <img src={details.picture} alt="What the text reader sees" />}
          <div>{details ? `Read in ${details.milliseconds} ms: ${details.text || '(nothing)'}` : 'Waiting for a reading…'}</div>
          <button onClick={savePicture} disabled={!details}>
            Save picture
          </button>
        </div>
      )}

      {reading && (
        <ResultPanel
          key={reading.id}
          db={db}
          initialCode={reading.code}
          hint={null}
          onAdd={(entry) => {
            onAdd(entry);
            close(reading);
          }}
          onClose={() => close(reading)}
        />
      )}
    </div>
  );
}
