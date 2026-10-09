import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraErrorMessage, sourceRect, startCamera } from './camera';

afterEach(() => vi.unstubAllGlobals());

describe('sourceRect', () => {
  it('accounts for horizontal cropping when the video is wider than the element', () => {
    const rect = sourceRect(
      { width: 1000, height: 500 },
      { width: 500, height: 500 },
      { x: 100, y: 200, width: 300, height: 50 },
    );
    expect(rect).toEqual({ x: 350, y: 200, width: 300, height: 50 });
  });

  it('accounts for vertical cropping and scaling when the video is taller than the element', () => {
    const rect = sourceRect(
      { width: 400, height: 800 },
      { width: 200, height: 200 },
      { x: 50, y: 50, width: 100, height: 20 },
    );
    expect(rect).toEqual({ x: 100, y: 300, width: 200, height: 40 });
  });

  it('maps one to one when sizes match', () => {
    const rect = sourceRect(
      { width: 640, height: 480 },
      { width: 640, height: 480 },
      { x: 10, y: 20, width: 30, height: 40 },
    );
    expect(rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
});

describe('startCamera', () => {
  function fakeCamera() {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    return track;
  }

  it('returns a function that turns the camera off', async () => {
    const track = fakeCamera();
    const video = { srcObject: null, play: async () => {} } as unknown as HTMLVideoElement;
    const stop = await startCamera(video);
    expect(track.stop).not.toHaveBeenCalled();
    stop();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('turns the camera off again when the preview cannot start', async () => {
    const track = fakeCamera();
    const video = {
      srcObject: null,
      play: async () => {
        throw new Error('play interrupted');
      },
    } as unknown as HTMLVideoElement;
    await expect(startCamera(video)).rejects.toThrow('play interrupted');
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});

describe('cameraErrorMessage', () => {
  it('explains a denied permission', () => {
    const error = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    expect(cameraErrorMessage(error)).toMatch(/denied/i);
    expect(cameraErrorMessage(error)).toMatch(/settings/i);
  });

  it('reports other failures with their message', () => {
    expect(cameraErrorMessage(new Error('no device'))).toContain('no device');
    expect(cameraErrorMessage('odd')).toContain('odd');
  });
});
