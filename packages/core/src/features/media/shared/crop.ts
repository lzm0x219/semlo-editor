/** A crop rectangle expressed in the currently rotated image's visual coordinates. */
export interface ImageCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ImageCropHandle = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
const fullRect = (): ImageCropRect => ({ x: 0, y: 0, width: 1, height: 1 });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
/** Clamp externally supplied data; invalid or empty rectangles mean the full image. */
export function normalizeImageCropRect(value: unknown): ImageCropRect {
  if (!value || typeof value !== "object") return fullRect();
  const { x, y, width, height } = value as Record<string, unknown>;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    return fullRect();
  const left = round(clamp(x, 0, 1));
  const top = round(clamp(y, 0, 1));
  const right = round(clamp(x + width, 0, 1));
  const bottom = round(clamp(y + height, 0, 1));
  if (right <= left || bottom <= top) return fullRect();
  return { x: left, y: top, width: round(right - left), height: round(bottom - top) };
}

/** Convert a visual rectangle when the entire image rotates clockwise. */
export function rotateImageCropRect(value: unknown, clockwiseQuarterTurns: number): ImageCropRect {
  let rect = normalizeImageCropRect(value);
  const turns = Number.isFinite(clockwiseQuarterTurns) ? ((Math.trunc(clockwiseQuarterTurns) % 4) + 4) % 4 : 0;
  for (let index = 0; index < turns; index += 1) {
    rect = normalizeImageCropRect({
      x: 1 - rect.y - rect.height,
      y: rect.x,
      width: rect.height,
      height: rect.width,
    });
  }
  return rect;
}

export function updateImageCropRect(
  rect: ImageCropRect,
  handle: ImageCropHandle,
  dx: number,
  dy: number,
  minW: number,
  minH: number,
) {
  if (handle === "move") {
    return normalizeImageCropRect({
      ...rect,
      x: clamp(rect.x + dx, 0, 1 - rect.width),
      y: clamp(rect.y + dy, 0, 1 - rect.height),
    });
  }
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - minW);
  if (handle.includes("e")) right = clamp(right + dx, left + minW, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - minH);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + minH, 1);
  return normalizeImageCropRect({ x: left, y: top, width: right - left, height: bottom - top });
}
