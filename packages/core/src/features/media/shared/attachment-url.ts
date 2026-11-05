export const safeAttachmentURL = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 4096) return null;
  if (Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return null;
  const url = value.trim();
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) return url;
  try {
    if (["http:", "https:", "blob:"].includes(new URL(url).protocol)) return url;
  } catch {
    /* invalid URL */
  }
  return null;
};

// 非法地址不能成为可执行的 href/src，但仍须保留原始内容供文档往返。
export function encodeStoredAttachmentURL(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("媒体地址无法序列化");
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeStoredAttachmentURL(value: string): unknown {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error("媒体地址数据损坏", { cause: error });
  }
}

export function needsStoredAttachmentURL(value: unknown, safe: string | null): boolean {
  return value !== "" && !(typeof value === "string" && value === safe);
}
