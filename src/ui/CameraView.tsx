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
    let generation = 0; // bumped on every halt, so a late start knows it is stale
    let stop: (() => void) | null = null;

    function halt() {
      generation++;
      stop?.();
      stop = null;
      setRunning(false);
    }

    function begin() {
      const mine = ++generation;
      startCamera(videoRef.current!)
        .then((stopCamera) => {
          if (mine !== generation) {
            stopCamera();
            return;
          }
          stop = stopCamera;
          setRunning(true);
        })
        .catch((error) => {
          if (mine === generation) onError(cameraErrorMessage(error));
        });
    }

    // Phones often hand back a frozen or black picture after the app was in the
    // background, so the camera is released when hidden and restarted when shown.
    function onVisibility() {
      halt();
      if (document.visibilityState === 'visible') begin();
    }

    begin();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      halt();
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
