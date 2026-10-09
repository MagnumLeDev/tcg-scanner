import { useState } from 'react';
import { recognise } from '../ocr/ocr';
import { extract, languageOf, parse } from '../setCode';
import { CameraView } from './CameraView';

type Reading = { raw: string; code: string | null; milliseconds: number; preview: string };

export function ScanScreen() {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleCapture(canvas: HTMLCanvasElement) {
    setBusy(true);
    setFailure(null);
    const started = performance.now();
    try {
      const raw = await recognise(canvas);
      setReading({
        raw,
        code: extract(raw),
        milliseconds: Math.round(performance.now() - started),
        preview: canvas.toDataURL('image/png'),
      });
    } catch (error) {
      setFailure(`Reading failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  if (cameraError) {
    return <p className="pad error">{cameraError}</p>;
  }

  return (
    <div className="scan">
      <CameraView busy={busy} onCapture={handleCapture} onError={setCameraError} />
      <div className="scan-result pad stack">
        {failure && <p className="error">{failure}</p>}
        {!reading && !failure && <p className="muted">Nothing scanned yet.</p>}
        {reading && (
          <>
            <img className="scan-preview" src={reading.preview} alt="Scanned area" />
            <div>
              <strong>{reading.code ?? 'No code found — move closer and retry'}</strong>
              {reading.code && <span className="muted"> · {languageOf(parse(reading.code).region)}</span>}
            </div>
            <div className="muted">
              Raw text: “{reading.raw.trim()}” · {reading.milliseconds} ms
            </div>
          </>
        )}
      </div>
    </div>
  );
}
