import { useEffect, useRef, useState } from 'react';
import { cameraErrorMessage, captureFrame, startCamera } from '../camera';

type Props = {
  busy: boolean;
  onCapture: (canvas: HTMLCanvasElement) => void;
  onError: (message: string) => void;
};

export function CameraView({ busy, onCapture, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    startCamera(videoRef.current!)
      .then((stopCamera) => {
        if (cancelled) {
          stopCamera();
          return;
        }
        stop = stopCamera;
        setRunning(true);
      })
      .catch((error) => {
        if (!cancelled) onError(cameraErrorMessage(error));
      });
    return () => {
      cancelled = true;
      stop?.();
    };
    // The camera is started once per mount; onError is not a dependency on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="camera">
      <video ref={videoRef} playsInline muted autoPlay />
      <div className="camera-frame" ref={frameRef} />
      <p className="camera-hint">Line the set code up inside the frame</p>
      <button
        className="primary camera-capture"
        disabled={!running || busy}
        onClick={() => onCapture(captureFrame(videoRef.current!, frameRef.current!))}
      >
        {busy ? 'Reading…' : 'Scan'}
      </button>
    </div>
  );
}
