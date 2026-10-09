export type Rect = { x: number; y: number; width: number; height: number };

type Size = { width: number; height: number };

// The video is shown with object-fit: cover, so it is scaled to fill the element
// and cropped equally on the overflowing sides.
export function sourceRect(video: Size, element: Size, frame: Rect): Rect {
  const scale = Math.max(element.width / video.width, element.height / video.height);
  const offsetX = (element.width - video.width * scale) / 2;
  const offsetY = (element.height - video.height * scale) / 2;
  return {
    x: (frame.x - offsetX) / scale,
    y: (frame.y - offsetY) / scale,
    width: frame.width / scale,
    height: frame.height / scale,
  };
}

export async function startCamera(video: HTMLVideoElement): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('this browser does not give web pages access to the camera');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = stream;
  await video.play();
  return () => stream.getTracks().forEach((track) => track.stop());
}

export function captureFrame(video: HTMLVideoElement, frameElement: HTMLElement): HTMLCanvasElement {
  const videoBox = video.getBoundingClientRect();
  const frameBox = frameElement.getBoundingClientRect();
  const source = sourceRect(
    { width: video.videoWidth, height: video.videoHeight },
    { width: videoBox.width, height: videoBox.height },
    {
      x: frameBox.left - videoBox.left,
      y: frameBox.top - videoBox.top,
      width: frameBox.width,
      height: frameBox.height,
    },
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width);
  canvas.height = Math.round(source.height);
  canvas
    .getContext('2d')!
    .drawImage(video, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function cameraErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return 'Camera access was denied. Allow the camera for this site in your browser settings, then reload.';
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `The camera is not available: ${detail}`;
}
