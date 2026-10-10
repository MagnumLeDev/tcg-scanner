export type Line = { text: string; confidence: number };

// What one look at the picture gave: lines shaped like a set code, and lines that may be the card name.
// Only a look at the whole picture can give a name.
export type Reading = { codes: Line[]; names: Line[]; whole: boolean };

// Turns the reading model's output into text. The model gives, for each step
// along the line, a score per character; position 0 means "nothing here". A
// character held over several steps is one character.
export function decode(scores: Float32Array, steps: number, classes: number, characters: string[]): Line {
  let text = '';
  let confidence = 1;
  let previous = 0;
  for (let step = 0; step < steps; step++) {
    let best = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < classes; index++) {
      const score = scores[step * classes + index];
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }
    if (best !== 0 && best !== previous) {
      text += characters[best] ?? '';
      confidence = Math.min(confidence, bestScore);
    }
    previous = best;
  }
  return text === '' ? { text: '', confidence: 0 } : { text, confidence };
}
