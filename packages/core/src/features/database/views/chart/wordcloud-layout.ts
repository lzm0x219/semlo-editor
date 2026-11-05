export type WordcloudShape = "cloud" | "circle" | "ellipse";

export interface WordcloudLayoutWord {
  key: string;
  label: string;
  value: number;
}

export interface WordcloudPlacement extends WordcloudLayoutWord {
  x: number;
  y: number;
  fontSize: number;
  rotation: number;
  /** Axis-aligned bounds include a small gap between neighbouring words. */
  bounds: { x: number; y: number; width: number; height: number };
}

export type WordcloudMeasure = (label: string, fontSize: number) => number;

const width = 320;
const height = 200;
const centerX = width / 2;
const centerY = height / 2;

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.codePointAt(0)!, 16777619);
  return result >>> 0;
}

function inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
}

function inside(shape: WordcloudShape, x: number, y: number): boolean {
  if (x < 4 || x > width - 4 || y < 4 || y > height - 4) return false;
  if (shape === "circle") return inEllipse(x, y, centerX, centerY, 94, 94);
  if (shape === "ellipse") return inEllipse(x, y, centerX, centerY, 155, 94);
  return (
    inEllipse(x, y, centerX - 65, centerY + 15, 86, 65) ||
    inEllipse(x, y, centerX, centerY - 6, 88, 87) ||
    inEllipse(x, y, centerX + 65, centerY + 15, 86, 65)
  );
}

function overlaps(a: WordcloudPlacement["bounds"], b: WordcloudPlacement["bounds"]): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Place measured words on a deterministic spiral. Each candidate is checked
 * against the requested shape and the already placed words, so resizing the
 * containing SVG does not cause the labels to overlap.
 */
export function layoutWordcloud(
  words: readonly WordcloudLayoutWord[],
  shape: WordcloudShape,
  measure: WordcloudMeasure,
): WordcloudPlacement[] {
  const input = words.filter((word) => word.label && Number.isFinite(word.value) && word.value > 0);
  if (!input.length) return [];
  const maximum = Math.max(...input.map((word) => word.value));
  const minimum = Math.min(...input.map((word) => word.value));
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  let best: WordcloudPlacement[] = [];
  // Reflow the entire cloud at a smaller scale if a dense set of words does
  // not fit. Reducing only the last word leaves early ones occupying too much.
  for (let cloudScale = 1; cloudScale >= 0.25; cloudScale *= 0.8) {
    const placed: WordcloudPlacement[] = [];
    let consecutiveMisses = 0;
    for (const word of input) {
      const proportion = maximum === minimum ? 0.55 : (word.value - minimum) / (maximum - minimum);
      const desiredSize = (13 + proportion * 35) * cloudScale;
      const choices = [0, 20, -20, 0, 20, -20];
      const rotation = choices[hash(word.key || word.label) % choices.length];
      const angle = (rotation * Math.PI) / 180;
      const cosine = Math.abs(Math.cos(angle));
      const sine = Math.abs(Math.sin(angle));
      let found: WordcloudPlacement | undefined;

      for (let scale = 1; scale >= 0.38 && !found; scale *= 0.82) {
        let fontSize = Math.max(4, desiredSize * scale);
        let textWidth = measure(word.label, fontSize);
        if (!Number.isFinite(textWidth) || textWidth <= 0) textWidth = Array.from(word.label).length * fontSize;
        const maxWidth = shape === "circle" ? 170 : 280;
        const scaleToFit = Math.min(
          1,
          maxWidth / (textWidth * cosine + fontSize * 1.2 * sine),
          170 / (textWidth * sine + fontSize * 1.2 * cosine),
        );
        fontSize *= scaleToFit;
        textWidth *= scaleToFit;
        const textHeight = fontSize * 1.2;
        // SVG glyph bounds can differ slightly from the canvas advance width;
        // leave enough space for font overhang and subpixel rounding.
        const boxWidth = textWidth * cosine + textHeight * sine + 8;
        const boxHeight = textWidth * sine + textHeight * cosine + 8;
        const offset = (hash(word.label) % 360) * (Math.PI / 180);

        for (let attempt = 0; attempt < 850; attempt++) {
          const radius = Math.sqrt(attempt / 849) * 170;
          const angle = attempt * goldenAngle + offset;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle) * 0.62;
          const bounds = { x: x - boxWidth / 2, y: y - boxHeight / 2, width: boxWidth, height: boxHeight };
          if (
            !inside(shape, bounds.x, bounds.y) ||
            !inside(shape, bounds.x + bounds.width, bounds.y) ||
            !inside(shape, bounds.x, bounds.y + bounds.height) ||
            !inside(shape, bounds.x + bounds.width, bounds.y + bounds.height) ||
            placed.some((other) => overlaps(bounds, other.bounds))
          )
            continue;
          found = { ...word, x, y, fontSize, rotation, bounds };
          break;
        }
      }
      if (found) {
        placed.push(found);
        consecutiveMisses = 0;
      } else if (++consecutiveMisses >= 8) break;
    }
    if (placed.length > best.length) best = placed;
    if (placed.length === input.length) break;
  }
  return best;
}
