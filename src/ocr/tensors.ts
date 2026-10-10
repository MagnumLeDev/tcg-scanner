// The two models take pictures as three planes of numbers (one per colour), each
// scaled the way the model was trained. These turn canvas pixels into that layout.

const MEAN = [0.485, 0.456, 0.406];
const DEVIATION = [0.229, 0.224, 0.225];

// For the model that finds where text is: red, green, blue planes.
export function detectionInput(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const plane = width * height;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let colour = 0; colour < 3; colour++) {
      input[colour * plane + i] = (rgba[i * 4 + colour] / 255 - MEAN[colour]) / DEVIATION[colour];
    }
  }
  return input;
}

// For the model that reads a line of text: blue, green, red planes, between -1 and 1.
export function recognitionInput(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const plane = width * height;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let colour = 0; colour < 3; colour++) {
      input[colour * plane + i] = (rgba[i * 4 + (2 - colour)] / 255 - 0.5) / 0.5;
    }
  }
  return input;
}
