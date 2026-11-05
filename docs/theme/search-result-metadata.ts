import type { SearchSnapshot } from "./search-hooks";

type SearchIndexPage = {
  title: string;
  routePath: string;
  toc?: Array<{ id: string; text: string }>;
};

let cachedIndex: { url: string; pages: Promise<SearchIndexPage[]> } | undefined;

/** Reuse the index already loaded by Rspress to label a match with its real heading. */
export function loadSearchResultMetadata(): Promise<SearchIndexPage[]> {
  const link = document.querySelector<HTMLLinkElement>('link[rel="prefetch"][href*="search_index."]');
  if (!link) return Promise.resolve([]);
  if (cachedIndex?.url === link.href) return cachedIndex.pages;

  const url = link.href;
  const pages = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Search index returned ${response.status}`);
      return response.json() as Promise<unknown>;
    })
    .then((data) => (Array.isArray(data) ? (data as SearchIndexPage[]) : []))
    .catch(() => {
      if (cachedIndex?.url === url) cachedIndex = undefined;
      return [];
    });
  cachedIndex = { url, pages };
  return pages;
}

export function matchSearchPage(pages: SearchIndexPage[], href: string) {
  const resultUrl = new URL(href, window.location.href);
  return pages.find(
    (page) =>
      typeof page.routePath === "string" &&
      new URL(page.routePath, window.location.origin).pathname === resultUrl.pathname,
  );
}

export function searchSectionTitle(page: SearchIndexPage | undefined, href: string) {
  if (!page) return undefined;
  const hash = new URL(href, window.location.href).hash.slice(1);
  if (!hash) return page.title;
  try {
    const id = decodeURIComponent(hash);
    return page.toc?.find((heading) => heading.id === id)?.text;
  } catch {
    return undefined;
  }
}

/** Rspress publishes results before React commits them, so compare against the rendered rows. */
export function matchesRenderedSearch(panel: HTMLElement, snapshot: SearchSnapshot) {
  const rows = Array.from(panel.querySelectorAll<HTMLElement>(".rp-suggest-item"));
  if (!snapshot.items.length) {
    return panel.querySelector(".rp-no-search-result__text b")?.textContent === `"${snapshot.query}"`;
  }
  if (rows.length !== snapshot.items.length) return false;
  const normalize = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";
  return snapshot.items.every((item, index) => {
    const row = rows[index];
    const link = row?.querySelector<HTMLAnchorElement>(".rp-suggest-item__link");
    const text = row?.querySelector(
      item.type === "content" ? ".rp-suggest-item__statement" : ".rp-suggest-item__header",
    );
    const expected = item.type === "content" ? item.statement : item.header;
    return (
      link?.href === new URL(item.link, window.location.href).href &&
      normalize(text?.textContent) === normalize(expected)
    );
  });
}
