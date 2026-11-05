import { imageLinkInput } from "../shared/image-link";

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type ImageStyle = "none" | "border" | "shadow";
export type ImageAlign = "left" | "center" | "right";
export const imageStyle = (value: unknown): ImageStyle => (value === "border" || value === "shadow" ? value : "none");
export const imageAlign = (value: unknown): ImageAlign => (value === "center" || value === "right" ? value : "left");
export const imageCaption = (value: unknown) => (typeof value === "string" ? value : "");
export const imageHref = (value: unknown) => imageLinkInput(value) ?? "";
export const imageElement = (element: HTMLElement): HTMLElement | null =>
  element.matches("img") ? element : element.querySelector("img[src]");
export const imageStyleCSS = (style: ImageStyle) =>
  style === "border" ? "border: 1px solid #e7e9e8" : style === "shadow" ? "box-shadow: 0 3px 6px rgba(0,0,0,.12)" : "";
export const corners: Array<[Corner, string]> = [
  ["top-left", "左上"],
  ["top-right", "右上"],
  ["bottom-left", "左下"],
  ["bottom-right", "右下"],
];
export const dimension = (value: unknown) => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isFinite(number) && number > 0 && number <= 1_000_000 ? number : null;
};
