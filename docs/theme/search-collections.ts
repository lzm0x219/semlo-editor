export type SavedSearchEntry = { href: string; title: string; source?: string };
export type SearchCollections = { favorites: SavedSearchEntry[]; recent: SavedSearchEntry[] };

export const SEARCH_COLLECTIONS_KEY = "semlo-editor:docs:search:collections:v1";
export const MAX_SEARCH_FAVORITES = 20;
export const MAX_SEARCH_RECENT = 5;

export function searchHref(value: string): string | null {
  try {
    const url = new URL(value, window.location.href);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

function sanitizeEntry(value: unknown): SavedSearchEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.href !== "string" || typeof entry.title !== "string") return null;
  const href = searchHref(entry.href);
  const title = entry.title.trim().slice(0, 160);
  if (!href || !title) return null;
  const source = typeof entry.source === "string" ? entry.source.trim().slice(0, 160) : "";
  return { href, title, ...(source ? { source } : {}) };
}

function sanitizeList(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: SavedSearchEntry[] = [];
  for (const raw of value) {
    const entry = sanitizeEntry(raw);
    if (!entry || seen.has(entry.href)) continue;
    seen.add(entry.href);
    result.push(entry);
    if (result.length === limit) break;
  }
  return result;
}

export function readSearchCollections(): SearchCollections {
  try {
    const raw = window.localStorage.getItem(SEARCH_COLLECTIONS_KEY);
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== "object") return { favorites: [], recent: [] };
    const collections = data as Record<string, unknown>;
    return {
      favorites: sanitizeList(collections.favorites, MAX_SEARCH_FAVORITES),
      recent: sanitizeList(collections.recent, MAX_SEARCH_RECENT),
    };
  } catch {
    return { favorites: [], recent: [] };
  }
}

export function writeSearchCollections(collections: SearchCollections) {
  try {
    window.localStorage.setItem(SEARCH_COLLECTIONS_KEY, JSON.stringify(collections));
    return true;
  } catch {
    return false;
  }
}
