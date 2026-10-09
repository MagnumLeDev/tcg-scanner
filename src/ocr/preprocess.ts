const RELATIVE_MARGIN = 0.06; // how much darker (or lighter) than its surroundings ink must be
const ABSOLUTE_MARGIN = 3; // keeps camera noise in flat areas from counting as ink

// Rewrites RGBA data in place as black ink on white. Each pixel is compared with
// the average of its neighbourhood rather than with the whole picture, so text
// stays readable whether it sits on a light frame, a dark frame or a glare.
// With `lightText`, pixels lighter than their surroundings become the ink.
export function binarise(data: Uint8ClampedArray, width: number, height: number, lightText: boolean): void {
  if (width === 0 || height === 0) return;
  const radius = Math.max(8, Math.round(height / 25));
  const stride = width + 1;

  // Summed-area table: integral[y * stride + x] is the sum of all grey values above and left of (x, y).
  const grey = new Float32Array(width * height);
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const value = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      grey[y * width + x] = value;
      row += value;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const value = grey[y * width + x];
      const ink = lightText
        ? value > mean * (1 + RELATIVE_MARGIN) + ABSOLUTE_MARGIN
        : value < mean * (1 - RELATIVE_MARGIN) - ABSOLUTE_MARGIN;
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = ink ? 0 : 255;
    }
  }
}

const MAX_GLYPH_HEIGHT = 0.13; // of the picture's height
const MAX_GLYPH_WIDTH = 0.16; // of the picture's height: letters are about as wide as tall
const MIN_GLYPH_PIXELS = 6;

// Takes a black-on-white picture (as made by `binarise`) and erases every blob of
// ink that cannot be a letter, digit or hyphen of the set code: frame edges, the
// artwork and specks. What is left is much easier for the text reader.
export function keepTextSizedInk(data: Uint8ClampedArray, width: number, height: number): void {
  const maxHeight = height * MAX_GLYPH_HEIGHT;
  const maxWidth = height * MAX_GLYPH_WIDTH;
  const visited = new Uint8Array(width * height);
  const blob = new Int32Array(width * height); // pixels of the blob being walked

  for (let start = 0; start < width * height; start++) {
    if (visited[start] || data[start * 4] !== 0) continue;

    let size = 0;
    let left = width, right = 0, top = height, bottom = 0;
    visited[start] = 1;
    blob[size++] = start;
    for (let next = 0; next < size; next++) {
      const pixel = blob[next];
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      for (const neighbour of [x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1, pixel - width, pixel + width]) {
        if (neighbour < 0 || neighbour >= width * height) continue;
        if (visited[neighbour] || data[neighbour * 4] !== 0) continue;
        visited[neighbour] = 1;
        blob[size++] = neighbour;
      }
    }

    const fits = size >= MIN_GLYPH_PIXELS && bottom - top + 1 <= maxHeight && right - left + 1 <= maxWidth;
    if (fits) continue;
    for (let i = 0; i < size; i++) {
      const o = blob[i] * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
    }
  }
}
