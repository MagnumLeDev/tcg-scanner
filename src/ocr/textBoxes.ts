export type Box = { left: number; top: number; right: number; bottom: number }; // edges included

const THRESHOLD = 0.3; // how sure the model must be that a pixel belongs to text
const GROWTH = 0.75; // the model marks only the core of each line; letters reach this much further, in line heights
const MIN_HEIGHT = 3;
const MIN_WIDTH = 6;

// Takes the model's map of "how likely is this pixel to be text" and returns the
// outline of each line of text, in the pixels of the map.
export function findTextBoxes(probability: Float32Array, width: number, height: number): Box[] {
  const size = width * height;
  const visited = new Uint8Array(size);
  const region = new Int32Array(size); // pixels of the region being walked
  const boxes: Box[] = [];

  for (let start = 0; start < size; start++) {
    if (visited[start] || probability[start] < THRESHOLD) continue;

    let count = 0;
    let left = width, right = 0, top = height, bottom = 0;
    visited[start] = 1;
    region[count++] = start;
    for (let next = 0; next < count; next++) {
      const pixel = region[next];
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      for (const neighbour of [x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1, pixel - width, pixel + width]) {
        if (neighbour < 0 || neighbour >= size) continue;
        if (visited[neighbour] || probability[neighbour] < THRESHOLD) continue;
        visited[neighbour] = 1;
        region[count++] = neighbour;
      }
    }

    const regionHeight = bottom - top + 1;
    if (regionHeight < MIN_HEIGHT || right - left + 1 < MIN_WIDTH) continue;
    const grow = Math.round(regionHeight * GROWTH);
    boxes.push({
      left: Math.max(0, left - grow),
      top: Math.max(0, top - grow),
      right: Math.min(width - 1, right + grow),
      bottom: Math.min(height - 1, bottom + grow),
    });
  }
  return boxes;
}
