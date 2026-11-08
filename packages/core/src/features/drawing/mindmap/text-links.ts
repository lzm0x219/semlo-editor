import { normalizeLinkURL } from "../../references/link-command";

export interface MindmapLink {
  from: number;
  to: number;
  href: string;
}

export interface MindmapLinkedText {
  text: string;
  href?: string;
  links?: MindmapLink[];
}

/** 不允许链接边界拆开 UTF-16 代理对。 */
export function textBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1),
    after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

export function validTextLinks(text: string, href: unknown, links: unknown): boolean {
  if (href !== undefined && (typeof href !== "string" || !text || normalizeLinkURL(href) !== href)) return false;
  if (links === undefined) return true;
  if (href !== undefined || !Array.isArray(links) || links.length > 1024) return false;
  let previous = 0;
  for (const link of links) {
    if (
      !link ||
      typeof link !== "object" ||
      Array.isArray(link) ||
      Object.keys(link).some((key) => !["from", "to", "href"].includes(key)) ||
      !Number.isSafeInteger(link.from) ||
      !Number.isSafeInteger(link.to) ||
      link.from < previous ||
      link.to <= link.from ||
      link.to > text.length ||
      !textBoundary(text, link.from) ||
      !textBoundary(text, link.to) ||
      typeof link.href !== "string" ||
      normalizeLinkURL(link.href) !== link.href
    )
      return false;
    previous = link.to;
  }
  return true;
}

export function itemLinks(item: MindmapLinkedText): MindmapLink[] {
  return item.href && item.text
    ? [{ from: 0, to: item.text.length, href: item.href }]
    : (item.links ?? []).map((link) => ({ ...link }));
}

export function assignLinks(item: MindmapLinkedText, links: MindmapLink[]): void {
  const ordered = links.filter((link) => link.to > link.from).sort((a, b) => a.from - b.from);
  const merged: MindmapLink[] = [];
  for (const link of ordered) {
    const last = merged[merged.length - 1];
    if (last && last.href === link.href && last.to === link.from) last.to = link.to;
    else merged.push({ ...link });
  }
  delete item.href;
  delete item.links;
  if (merged.length === 1 && merged[0].from === 0 && merged[0].to === item.text.length) item.href = merged[0].href;
  else if (merged.length) item.links = merged;
}

export function replaceItemText(
  item: MindmapLinkedText,
  from: number,
  to: number,
  text: string,
  href: string | null,
): void {
  const old = item.text;
  const shift = text.length - (to - from);
  const links: MindmapLink[] = [];
  for (const link of itemLinks(item)) {
    if (link.from < from) {
      const end = Math.min(link.to, from);
      if (end > link.from) links.push({ ...link, to: end });
    }
    if (link.to > to) {
      const start = Math.max(link.from, to);
      if (start < link.to) links.push({ ...link, from: start + shift, to: link.to + shift });
    }
  }
  item.text = old.slice(0, from) + text + old.slice(to);
  if (href && text) links.push({ from, to: from + text.length, href });
  assignLinks(item, links);
}

export function changeItemText(item: MindmapLinkedText, text: string): void {
  const oldChars = Array.from(item.text),
    newChars = Array.from(text);
  let prefix = 0,
    suffix = 0;
  while (prefix < oldChars.length && prefix < newChars.length && oldChars[prefix] === newChars[prefix]) prefix++;
  while (
    suffix < oldChars.length - prefix &&
    suffix < newChars.length - prefix &&
    oldChars[oldChars.length - suffix - 1] === newChars[newChars.length - suffix - 1]
  )
    suffix++;
  const from = oldChars.slice(0, prefix).join("").length;
  const to = oldChars.slice(0, oldChars.length - suffix).join("").length;
  const inserted = newChars.slice(prefix, newChars.length - suffix).join("");
  const inherited =
    item.href ??
    item.links?.find(
      (link) => link.from <= from && link.to >= to && (from !== to || (from > link.from && from < link.to)),
    )?.href ??
    null;
  replaceItemText(item, from, to, inserted, inherited);
}
