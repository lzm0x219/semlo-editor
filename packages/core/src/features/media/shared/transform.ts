import { normalizeImageCropRect, rotateImageCropRect, type ImageCropRect } from "./crop";

export type ImageRotation = 0 | 90 | 180 | 270;
export const imageRotation = (value: unknown): ImageRotation => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return number === 90 || number === 180 || number === 270 ? number : 0;
};
export const turned = (rotation: ImageRotation) => rotation === 90 || rotation === 270;
export const fullImageCrop = (): ImageCropRect => ({ x: 0, y: 0, width: 1, height: 1 });
export const imageCrop = (value: unknown): ImageCropRect | null => {
  let input = value;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  const rect = normalizeImageCropRect(input);
  return rect.x === 0 && rect.y === 0 && rect.width === 1 && rect.height === 1 ? null : rect;
};
export const imageCropClip = (crop: ImageCropRect, rotation: ImageRotation) => {
  const original = rotateImageCropRect(crop, -rotation / 90);
  return `inset(${original.y * 100}% ${(1 - original.x - original.width) * 100}% ${(1 - original.y - original.height) * 100}% ${original.x * 100}%)`;
};

/** A bounded image box in the visible frame's coordinates. */
export const imageTransform = (rotation: ImageRotation, crop: ImageCropRect, width: number, height: number) => {
  const fullWidth = width / crop.width;
  const fullHeight = height / crop.height;
  if (
    !Number.isFinite(fullWidth) ||
    !Number.isFinite(fullHeight) ||
    fullWidth <= 0 ||
    fullHeight <= 0 ||
    fullWidth > 1_000_000 ||
    fullHeight > 1_000_000
  )
    return null;
  const geometry = {
    left: ((0.5 - crop.x) / crop.width) * 100,
    top: ((0.5 - crop.y) / crop.height) * 100,
    width: ((turned(rotation) ? fullHeight : fullWidth) / width) * 100,
    height: ((turned(rotation) ? fullWidth : fullHeight) / height) * 100,
  };
  return Object.values(geometry).every(Number.isFinite) ? geometry : null;
};
