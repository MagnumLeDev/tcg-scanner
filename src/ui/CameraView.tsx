import { useEffect, useRef, useState } from 'react';
import { cameraErrorMessage, captureFrame, startCamera } from '../camera';

type Props = {
  // While paused the camera keeps showing, but nothing is read.
  paused: boolean;
  // Called over and over with the part of the picture where the set code sits.
  onFrame: (canvas: HTMLCanvasElement) => Promise<void>;
  onError: (message: string) => void;
};

const PAUSE_BETWEEN_READINGS_MS = 120;

export function CameraView({ paused, onFrame, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

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

  useEffect(() => {
    if (!running || paused) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      const video = videoRef.current;
      const band = bandRef.current;
      if (!active || !video || !band) return;
      if (video.videoWidth > 0) {
        try {
          await onFrameRef.current(captureFrame(video, band));
        } catch {
          // One unreadable frame is not worth stopping for; the next one follows.
        }
      }
      if (active) timer = setTimeout(tick, PAUSE_BETWEEN_READINGS_MS);
    }

    tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [running, paused]);

  return (
    <div className="camera">
      <video ref={videoRef} playsInline muted autoPlay />
      <div className="camera-card">
        <div className="camera-band" ref={bandRef} />
      </div>
    </div>
  );
}
