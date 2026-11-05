/** Return a safe destination, or null for an empty or invalid address. */
export function safeImageLinkURL(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    value.includes("\\") ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    return null;
  let href = value.trim();
  if (!href) return null;
  if (href.startsWith("/")) return href.startsWith("//") ? null : href;
  if (href.startsWith("#") || href.startsWith("./") || href.startsWith("../")) return href;
  if (/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/iu.test(href)) href = `https://${href}`;
  try {
    const parsed = new URL(href);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? href : null;
  } catch {
    return null;
  }
}

/** Preserve ordinary unfinished input while excluding unsafe schemes and characters. */
export function imageLinkInput(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    value.includes("\\") ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    return null;
  const input = value.trim();
  if (!input || safeImageLinkURL(input)) return input;
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(input) ? null : input;
}
