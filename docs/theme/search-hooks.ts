import type { AfterSearch, DefaultMatchResult, DefaultMatchResultItem } from "@rspress/core/theme-original";

export const SEARCH_COMPLETE_EVENT = "semlo-editor:search-complete";
export type SearchSnapshot = { query: string; items: DefaultMatchResultItem[] };

/** Let the search interface distinguish new results from the previous query. */
export const afterSearch: AfterSearch = (query, results) => {
  if (typeof window === "undefined") return;
  const result = results.find((item): item is DefaultMatchResult => item.renderType === "default");
  if (!result) return;
  // 按页面聚合搜索结果，让同一页面的条目在界面中保持相邻。
  const groups = new Map<string, DefaultMatchResultItem[]>();
  for (const item of result.result) {
    const group = groups.get(item.title) ?? [];
    group.push(item);
    groups.set(item.title, group);
  }
  window.dispatchEvent(
    new CustomEvent<SearchSnapshot>(SEARCH_COMPLETE_EVENT, {
      detail: { query, items: Array.from(groups.values()).flat() },
    }),
  );
};
