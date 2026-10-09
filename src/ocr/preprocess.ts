function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  const target = fraction * total;
  let seen = 0;
  for (let value = 0; value < 256; value++) {
    seen += histogram[value];
    if (seen > 0 && seen >= target) return value;
  }
  return 255;
}

// Rewrites RGBA data in place: greyscale, contrast stretched between the 2nd and
// 98th percentile, and inverted when the image is mostly dark so text is dark on light.
// `flip` reverses that choice, for crops where "mostly dark" guesses wrong.
export function toHighContrastGrey(data: Uint8ClampedArray, flip = false): void {
  const count = data.length / 4;
  if (count === 0) return;

  const grey = new Uint8Array(count);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const g = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
    grey[i] = g;
    histogram[g]++;
  }

  const low = percentile(histogram, count, 0.02);
  const high = percentile(histogram, count, 0.98);
  const range = high - low;
  if (range === 0) return;

  let sum = 0;
  for (let i = 0; i < count; i++) {
    const stretched = Math.max(0, Math.min(255, Math.round(((grey[i] - low) * 255) / range)));
    grey[i] = stretched;
    sum += stretched;
  }

  const invert = sum / count < 128 !== flip;
  for (let i = 0; i < count; i++) {
    const value = invert ? 255 - grey[i] : grey[i];
    const o = i * 4;
    data[o] = value;
    data[o + 1] = value;
    data[o + 2] = value;
  }
}
