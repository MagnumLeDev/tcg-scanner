import { extract } from './setCode';

const two = (value: number) => String(value).padStart(2, '0');

// Name for a camera picture saved to help tune the reader: the code the user
// typed (so the picture says what should have been read), then the time.
export function sampleFileName(typedCode: string, now: Date): string {
  const code = extract(typedCode) ?? 'unknown';
  const day = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `${code}_${day}-${time}.png`;
}
