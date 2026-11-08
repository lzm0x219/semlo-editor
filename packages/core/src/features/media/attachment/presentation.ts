export type AttachmentDisplayMode = "title" | "card" | "embedded";
export const defaultAttachmentHeight = 418;
export const minimumAttachmentHeight = 160;
export const maximumAttachmentHeight = 1600;

/** 未知显示属性可以保留，但不能让 JSON 序列化把不可保存的值悄悄变成 null。 */
export function serializePresentationValue(value: unknown): string {
  const pending = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    if (
      item === undefined ||
      typeof item === "function" ||
      typeof item === "symbol" ||
      typeof item === "bigint" ||
      (typeof item === "number" && (!Number.isFinite(item) || Object.is(item, -0)))
    )
      throw new Error("附件显示属性包含不可保存的值");
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    const prototype = Object.getPrototypeOf(item);
    if (
      (!Array.isArray(item) && prototype !== null && Object.getPrototypeOf(prototype) !== null) ||
      Object.getOwnPropertySymbols(item).length
    )
      throw new Error("附件显示属性必须是普通 JSON 数据");
    const keys = Object.keys(item);
    if (
      (Array.isArray(item) && (keys.length !== item.length || keys.some((key, index) => key !== String(index)))) ||
      Object.getOwnPropertyNames(item).some((key) => {
        if (Array.isArray(item) && key === "length") return false;
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        return !descriptor.enumerable || "get" in descriptor || "set" in descriptor;
      })
    )
      throw new Error("附件显示属性不能包含稀疏数组或不可保存的属性");
    pending.push(...Object.values(item));
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new Error("附件显示属性无法保存", { cause: error });
  }
}

export function validatePresentationValue(value: unknown): void {
  serializePresentationValue(value);
}

export function readAttachmentPresentation(
  attrs: Record<string, unknown>,
): { supported: true; mode: AttachmentDisplayMode; height: number } | { supported: false; message: string } {
  const mode = attrs.displayMode ?? "title";
  const height = attrs.previewHeight ?? defaultAttachmentHeight;
  if (
    !["title", "card", "embedded"].includes(mode as string) ||
    typeof height !== "number" ||
    !Number.isInteger(height) ||
    height < minimumAttachmentHeight ||
    height > maximumAttachmentHeight
  )
    return { supported: false, message: "此附件的显示设置暂不受支持，原始设置已保留。" };
  return { supported: true, mode: mode as AttachmentDisplayMode, height };
}

const prefix = "data-semlo-editor-attachment-";

export function readPresentationHTML(element: HTMLElement, field: "mode" | "height"): unknown {
  const plain = element.getAttribute(prefix + field);
  const encoded = element.getAttribute(prefix + field + "-json");
  if (plain !== null && encoded !== null) throw new Error("附件显示属性标记冲突");
  if (encoded !== null) {
    try {
      const value: unknown = JSON.parse(encoded);
      validatePresentationValue(value);
      return value;
    } catch (error) {
      throw new Error("附件显示属性数据损坏", { cause: error });
    }
  }
  if (plain === null) return null;
  if (field === "mode") return plain;
  try {
    const value: unknown = JSON.parse(plain);
    validatePresentationValue(value);
    return value;
  } catch (error) {
    throw new Error("附件预览高度数据损坏", { cause: error });
  }
}

export function presentationHTML(attrs: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [attr, field] of [
    ["displayMode", "mode"],
    ["previewHeight", "height"],
  ] as const) {
    const value = attrs[attr];
    if (value == null) continue;
    const json = serializePresentationValue(value);
    if (
      (field === "mode" && ["title", "card", "embedded"].includes(value as string)) ||
      (field === "height" && typeof value === "number")
    )
      result[prefix + field] = String(value);
    else result[prefix + field + "-json"] = json;
  }
  return result;
}

export function formatAttachmentSize(size: unknown): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  const amount = size / 1024 ** Math.max(0, exponent);
  return `${Number(amount.toFixed(amount < 10 ? 2 : 1))} ${units[Math.max(0, exponent)]}`;
}
