import { Link } from "@rspress/core/theme-original";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  MAX_SEARCH_FAVORITES,
  MAX_SEARCH_RECENT,
  SEARCH_COLLECTIONS_KEY,
  readSearchCollections,
  searchHref,
  writeSearchCollections,
  type SavedSearchEntry,
  type SearchCollections,
} from "./search-collections";
import { SEARCH_COMPLETE_EVENT, type SearchSnapshot } from "./search-hooks";
import {
  loadSearchResultMetadata,
  matchesRenderedSearch,
  matchSearchPage,
  searchSectionTitle,
} from "./search-result-metadata";

const quickLinks = [
  { title: "快速开始", targetTitle: "安装与接入", description: "安装与接入", href: "/getting-started", icon: "start" },
  {
    title: "编辑与组织内容",
    targetTitle: "编辑与组织内容",
    description: "了解编辑能力",
    href: "/editing",
    icon: "edit",
  },
  { title: "API 参考", targetTitle: "API 参考", description: "配置与控制器", href: "/api", icon: "api" },
] as const;
const PROGRAMMATIC_SELECTION = 7429;
const COLLECTIONS_CHANGED = "semlo-editor:search-collections-changed";

type ActiveResult = { title: string; href: string; source?: string };
type ShortcutIcon = (typeof quickLinks)[number]["icon"] | "favorite" | "recent";
type SearchShortcut = SavedSearchEntry & {
  targetTitle: string;
  description: string;
  icon: ShortcutIcon;
  section: string;
};
type SearchAction = {
  id: string;
  title: string;
  keywords: string;
  section: string;
  disabled?: boolean;
};

function makeShortcuts(collections: SearchCollections): SearchShortcut[] {
  const favoriteHrefs = new Set(collections.favorites.map((item) => item.href));
  const recent = collections.recent.filter((item) => !favoriteHrefs.has(item.href));
  const used = new Set([...favoriteHrefs, ...recent.map((item) => item.href)]);
  return [
    ...collections.favorites.map((item) => ({
      ...item,
      targetTitle: item.title,
      description: item.source || "已收藏",
      icon: "favorite" as const,
      section: "已收藏",
    })),
    ...recent.map((item) => ({
      ...item,
      targetTitle: item.title,
      description: item.source || "最近访问",
      icon: "recent" as const,
      section: "最近访问",
    })),
    ...quickLinks.filter((item) => !used.has(item.href)).map((item) => ({ ...item, section: "快速访问" })),
  ];
}

function actionMatchScore(query: string, title: string, keywords: string) {
  if (!query) return 0;
  const name = title.toLocaleLowerCase();
  const terms = keywords.toLocaleLowerCase().split(/\s+/);
  if (name.includes(query)) return 0;
  if (terms.some((term) => term.includes(query))) return 1;
  if (!/^[a-z0-9]+$/.test(query)) return Infinity;
  return terms.some((term) => {
    let index = 0;
    for (const char of term) if (char === query[index]) index += 1;
    return index === query.length;
  })
    ? 2
    : Infinity;
}

function QuickLinkIcon({ icon }: { icon: ShortcutIcon }) {
  if (icon === "favorite") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="m10 3.2 1.9 3.9 4.3.6-3.1 3 .7 4.3L10 13l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
      </svg>
    );
  }
  if (icon === "recent") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="6.4" />
        <path d="M10 6.3v4l2.7 1.5" />
      </svg>
    );
  }
  if (icon === "start") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M5.5 3.5h5l4 4v9h-9zM10.5 3.5v4h4M8 11h4.5M8 13.5h3" />
      </svg>
    );
  }
  if (icon === "edit") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="m5 13.5 7.8-7.8 1.5 1.5-7.8 7.8L4.5 15.5zM11.7 6.8l1.5 1.5M9.5 15.5h5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m7.5 6.5-3.5 3.5 3.5 3.5m5-7 3.5 3.5-3.5 3.5m-1-9-3 11" />
    </svg>
  );
}

/** Extend the built-in search without replacing its index or search provider. */
export function SearchExperience() {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [activeResult, setActiveResult] = useState<ActiveResult | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionFilter, setActionFilter] = useState("");
  const [actionIndex, setActionIndex] = useState(0);
  const [moreActions, setMoreActions] = useState(false);
  const [notice, setNotice] = useState("");
  const [collections, setCollections] = useState<SearchCollections>({ favorites: [], recent: [] });
  const selectedRef = useRef(0);
  const linksRef = useRef<Array<HTMLAnchorElement | null>>([]);
  const collectionsRef = useRef<SearchCollections>(collections);
  const shortcutsRef = useRef<SearchShortcut[]>(makeShortcuts(collections));
  const activeLinkRef = useRef<HTMLAnchorElement | null>(null);
  const actionsOpenRef = useRef(false);
  const searchingRef = useRef(false);
  const actionInputRef = useRef<HTMLInputElement | null>(null);
  const actionListRef = useRef<HTMLDivElement | null>(null);
  const actionIndexRef = useRef(0);
  const suppressHoverRef = useRef(false);
  const shortcuts = makeShortcuts(collections);
  shortcutsRef.current = shortcuts;

  function updateCollections(next: SearchCollections, persist = true) {
    const currentHref = shortcutsRef.current[selectedRef.current]?.href;
    const nextShortcuts = makeShortcuts(next);
    const index = nextShortcuts.findIndex((item) => item.href === currentHref);
    selectedRef.current = index < 0 ? 0 : index;
    shortcutsRef.current = nextShortcuts;
    collectionsRef.current = next;
    setSelected(selectedRef.current);
    setCollections(next);
    const saved = !persist || writeSearchCollections(next);
    window.dispatchEvent(new Event(COLLECTIONS_CHANGED));
    return saved;
  }

  function entryForLink(link: HTMLAnchorElement | null): SavedSearchEntry | null {
    if (!link) return null;
    const href = searchHref(link.href);
    const title = (link.dataset.semloEditorTarget || link.textContent || "").trim().slice(0, 160);
    const source =
      link.dataset.semloEditorSource || link.closest<HTMLElement>(".rp-search-panel__group")?.dataset.semloEditorGroup;
    return href && title ? { href, title, ...(source ? { source } : {}) } : null;
  }

  function rememberLink(link: HTMLAnchorElement | null) {
    const entry = entryForLink(link);
    if (!entry) return;
    const recent = [entry, ...collectionsRef.current.recent.filter((item) => item.href !== entry.href)];
    updateCollections({ ...collectionsRef.current, recent: recent.slice(0, MAX_SEARCH_RECENT) });
  }

  function scrollSelectedShortcut() {
    requestAnimationFrame(() => {
      const scroller = panel?.querySelector<HTMLElement>(".semlo-editor-search__quick");
      const selected = linksRef.current[selectedRef.current];
      if (!scroller || !selected?.isConnected) return;
      const view = scroller.getBoundingClientRect();
      const row = selected.getBoundingClientRect();
      if (row.top < view.top) scroller.scrollTop += row.top - view.top - 4;
      else if (row.bottom > view.bottom) scroller.scrollTop += row.bottom - view.bottom + 4;
    });
  }

  function moveFavorite(link: HTMLAnchorElement | null, direction: -1 | 1) {
    const entry = entryForLink(link);
    if (!entry) return;
    const current = collectionsRef.current;
    const index = current.favorites.findIndex((item) => item.href === entry.href);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.favorites.length) return;
    const favorites = [...current.favorites];
    [favorites[index], favorites[target]] = [favorites[target], favorites[index]];
    const saved = updateCollections({ ...current, favorites });
    scrollSelectedShortcut();
    setNotice(`${direction < 0 ? "已上移收藏" : "已下移收藏"}${saved ? "" : "（未能保存到浏览器）"}`);
  }

  function setActions(open: boolean) {
    if (actionsOpenRef.current && !open) suppressHoverRef.current = true;
    if (open && !actionsOpenRef.current) {
      setActionFilter("");
      actionIndexRef.current = 0;
      setActionIndex(0);
    }
    actionsOpenRef.current = open;
    setActionsOpen(open);
  }

  function activeLink() {
    if (!panel) return null;
    return query ? activeLinkRef.current : linksRef.current[selectedRef.current];
  }

  function restoreInput() {
    panel?.querySelector<HTMLInputElement>(".rp-search-panel__input")?.focus();
  }

  function updateActionOverflow() {
    const list = actionListRef.current;
    setMoreActions(Boolean(list && list.scrollTop + list.clientHeight < list.scrollHeight - 2));
  }

  useEffect(() => {
    updateCollections(readSearchCollections(), false);
    const onStorage = (event: StorageEvent) => {
      if (event.key === SEARCH_COLLECTIONS_KEY || event.key === null) updateCollections(readSearchCollections(), false);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (actionsOpen) actionInputRef.current?.focus();
  }, [actionsOpen]);

  useEffect(() => {
    if (!panel || !actionsOpen) return;
    const actions = Array.from(
      panel.querySelectorAll<HTMLElement>('.semlo-editor-search__actions-menu [role="option"]'),
    );
    const selectedAction = actions[actionIndexRef.current];
    if (selectedAction && selectedAction.getAttribute("aria-disabled") !== "true") return;
    const next = actions.findIndex((action) => action.getAttribute("aria-disabled") !== "true");
    actionIndexRef.current = next < 0 ? 0 : next;
    setActionIndex(actionIndexRef.current);
  }, [panel, actionsOpen, actionFilter, collections]);

  useEffect(() => {
    const list = actionListRef.current;
    if (!actionsOpen || !list) return;
    updateActionOverflow();
    const observer = new ResizeObserver(updateActionOverflow);
    observer.observe(list);
    return () => observer.disconnect();
  }, [panel, actionsOpen, actionFilter, collections]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 2500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const root = document.getElementById("__rspress_modal_container");
    if (!root) return;
    const update = () => {
      const next = root.querySelector<HTMLElement>(".rp-search-panel__modal");
      setPanel((current) => (current === next ? current : next));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!panel) return;
    const input = panel.querySelector<HTMLInputElement>(".rp-search-panel__input");
    if (!input) return;

    input.placeholder = "搜索文档、章节或功能…";
    input.setAttribute("aria-describedby", "semlo-editor-search-help");
    setQuery(input.value);
    selectedRef.current = 0;
    setSelected(0);
    setAnnouncement("");
    setActiveResult(null);
    activeLinkRef.current = null;
    setActions(false);
    setNotice("");
    let pages: Awaited<ReturnType<typeof loadSearchResultMetadata>> = [];
    let snapshots: SearchSnapshot[] = [];
    let disposed = false;
    let scrollSelection = false;

    const setSearchingState = (value: boolean) => {
      searchingRef.current = value;
      panel.toggleAttribute("data-semlo-editor-pending", value);
      input.setAttribute("aria-busy", String(value));
      setSearching(value);
    };
    setSearchingState(Boolean(input.value));

    const updateInput = () => {
      setQuery(input.value);
      snapshots = [];
      setSearchingState(Boolean(input.value));
      activeLinkRef.current = null;
      setActiveResult(null);
      setNotice("");
      setActions(false);
      if (!input.value) {
        selectedRef.current = 0;
        setSelected(0);
        setAnnouncement("");
      }
    };
    const updateResults = () => {
      if (disposed) return;
      if (searchingRef.current) {
        const complete = snapshots.some(
          (snapshot) => snapshot.query === input.value && matchesRenderedSearch(panel, snapshot),
        );
        if (!complete && !panel.querySelector(".rp-search-panel__error")) return;
        setSearchingState(false);
      }
      for (const group of panel.querySelectorAll<HTMLElement>(".rp-search-panel__group")) {
        const firstLink = group.querySelector<HTMLAnchorElement>(".rp-suggest-item__link");
        if (!firstLink) continue;
        const page = matchSearchPage(pages, firstLink.href);
        const fallbackTitle =
          group.querySelector(".rp-suggest-item__title")?.textContent?.trim() ||
          group.querySelector(".rp-suggest-item__header")?.textContent?.split(" > ")[0]?.trim();
        const groupTitle = page?.title || fallbackTitle;
        if (groupTitle) group.dataset.semloEditorGroup = groupTitle;
        else delete group.dataset.semloEditorGroup;
        group.dataset.semloEditorCount = String(group.querySelectorAll(".rp-suggest-item").length);

        for (const item of group.querySelectorAll<HTMLElement>(".rp-suggest-item")) {
          const link = item.querySelector<HTMLAnchorElement>(".rp-suggest-item__link");
          const content = item.querySelector<HTMLElement>(".rp-suggest-item__content");
          const statement = item.querySelector<HTMLElement>(".rp-suggest-item__statement");
          const header = item.querySelector<HTMLElement>(".rp-suggest-item__header");
          const action = item.querySelector<HTMLElement>(".rp-suggest-item__action-icon");
          if (!link || !content) continue;
          const sectionTitle = searchSectionTitle(page, link.href);
          const targetTitle = sectionTitle || header?.textContent?.split(" > ").at(-1)?.trim() || groupTitle || "文档";
          link.dataset.semloEditorTarget = targetTitle;
          const href = searchHref(link.href);
          item.toggleAttribute(
            "data-semlo-editor-favorite",
            Boolean(href && collectionsRef.current.favorites.some((entry) => entry.href === href)),
          );
          const prefix = groupTitle ? `${groupTitle} > ` : "";
          const firstText = header?.firstChild;
          if (header && prefix && firstText?.nodeType === Node.TEXT_NODE && firstText.textContent?.startsWith(prefix)) {
            if (header.dataset.semloEditorPrefix !== prefix) {
              const range = document.createRange();
              range.setStart(firstText, 0);
              range.setEnd(firstText, prefix.length);
              const width = range.getBoundingClientRect().width;
              if (width) {
                header.style.setProperty("--semlo-prefix-width", `${width}px`);
                header.dataset.semloEditorPrefix = prefix;
              }
            }
          } else if (header) {
            delete header.dataset.semloEditorPrefix;
            header.style.removeProperty("--semlo-prefix-width");
          }
          if (statement && sectionTitle) content.dataset.semloEditorHeading = sectionTitle;
          else delete content.dataset.semloEditorHeading;
          if (action) action.dataset.semloEditorKind = statement ? "内容" : new URL(link.href).hash ? "章节" : "文档";
          const snippet = statement?.textContent?.replace(/\s+/g, " ").trim();
          const label = [targetTitle, groupTitle && groupTitle !== targetTitle ? groupTitle : "", snippet]
            .filter(Boolean)
            .join("，");
          if (label && link.getAttribute("aria-label") !== label) link.setAttribute("aria-label", label);
        }
      }
      const items = Array.from(panel.querySelectorAll<HTMLElement>(".rp-suggest-item"));
      const focused =
        document.activeElement instanceof HTMLAnchorElement && document.activeElement.matches(".rp-suggest-item__link")
          ? document.activeElement
          : null;
      const inActions =
        document.activeElement instanceof Element &&
        document.activeElement.closest(".semlo-editor-search__footer, .semlo-editor-search__actions-menu");
      const current =
        focused ||
        (inActions && activeLinkRef.current?.isConnected ? activeLinkRef.current : null) ||
        panel.querySelector<HTMLAnchorElement>(".rp-suggest-item--current .rp-suggest-item__link");
      activeLinkRef.current = current;
      const currentText = current?.getAttribute("aria-label") || current?.textContent?.replace(/\s+/g, " ").trim();
      const source = current?.closest<HTMLElement>(".rp-search-panel__group")?.dataset.semloEditorGroup;
      const target = current
        ? { href: current.href, title: current.dataset.semloEditorTarget || currentText || "文档", source }
        : null;
      setActiveResult((previous) =>
        previous?.href === target?.href && previous?.title === target?.title && previous?.source === target?.source
          ? previous
          : target,
      );
      if (items.length && currentText) setAnnouncement(`${items.length} 条结果，当前选择：${currentText}`);
      else if (panel.querySelector(".rp-no-search-result")) setAnnouncement("没有找到匹配的结果");
      else setAnnouncement("");
      if (scrollSelection && current) {
        scrollSelection = false;
        requestAnimationFrame(() => {
          const scroller = panel.querySelector<HTMLElement>(".rp-search-panel__results");
          if (!scroller || !current.isConnected) return;
          const view = scroller.getBoundingClientRect();
          const row = current.getBoundingClientRect();
          if (row.top < view.top) scroller.scrollTop += row.top - view.top - 4;
          else if (row.bottom > view.bottom) scroller.scrollTop += row.bottom - view.bottom + 4;
        });
      }
    };
    const openInNewTab = () => {
      const current = input.value ? activeLinkRef.current : linksRef.current[selectedRef.current];
      if (!current?.isConnected) return;
      rememberLink(current);
      const link = document.createElement("a");
      link.href = current.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      panel.append(link);
      link.click();
      link.remove();
      panel
        .querySelector<HTMLElement>(".rp-search-panel__cancel")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    const selectShortcut = (index: number) => {
      selectedRef.current = index;
      setSelected(index);
      scrollSelectedShortcut();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) {
        if (event.key === "Escape") event.stopImmediatePropagation();
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      const shortcut = modifier && event.key.toLowerCase() === "k";
      if (shortcut) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (actionsOpenRef.current) {
          setActions(false);
          input.focus();
        } else if (input.value ? activeLinkRef.current?.isConnected : linksRef.current[selectedRef.current]) {
          setActions(true);
        }
        return;
      }
      if (actionsOpenRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          setActions(false);
          input.focus();
        } else if (modifier && !event.altKey && !event.shiftKey && event.key === "Enter") {
          event.preventDefault();
          event.stopImmediatePropagation();
          openInNewTab();
        } else if (modifier && !event.altKey && !event.shiftKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const current = input.value ? activeLinkRef.current : linksRef.current[selectedRef.current];
          moveFavorite(current, event.key === "ArrowUp" ? -1 : 1);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Tab") {
          event.preventDefault();
          event.stopImmediatePropagation();
          const actions = panel.querySelectorAll<HTMLElement>('.semlo-editor-search__actions-menu [role="option"]');
          const step = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey) ? -1 : 1;
          if (actions.length) {
            let next = actionIndexRef.current;
            for (let offset = 0; offset < actions.length; offset++) {
              next = (next + step + actions.length) % actions.length;
              if (actions[next].getAttribute("aria-disabled") !== "true") break;
            }
            if (actions[next].getAttribute("aria-disabled") === "true") return;
            actionIndexRef.current = next;
            setActionIndex(next);
            actionInputRef.current?.focus();
            const list = panel.querySelector<HTMLElement>("#semlo-editor-search-actions");
            const option = actions[actionIndexRef.current];
            if (list && option) {
              const view = list.getBoundingClientRect();
              const row = option.getBoundingClientRect();
              if (row.top < view.top) list.scrollTop += row.top - view.top - 4;
              else if (row.bottom > view.bottom) list.scrollTop += row.bottom - view.bottom + 4;
            }
          }
        } else if (event.key === "Enter" && !modifier && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          event.stopImmediatePropagation();
          panel
            .querySelectorAll<HTMLElement>('.semlo-editor-search__actions-menu [role="option"]')
            [actionIndexRef.current]?.click();
        }
        return;
      }
      if (event.target === input && searchingRef.current && ["Enter", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.target === input && modifier && !event.shiftKey && !event.altKey && event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        openInNewTab();
        return;
      }
      if (
        event.target === input &&
        !input.value &&
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        !event.shiftKey &&
        ((modifier && !event.altKey) || (event.altKey && !modifier))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const entries = shortcutsRef.current;
        const direction = event.key === "ArrowDown" ? 1 : -1;
        if (modifier) {
          const sections = [...new Set(entries.map((item) => item.section))];
          const currentSection = sections.indexOf(entries[selectedRef.current]?.section);
          const nextSection = Math.max(0, Math.min(sections.length - 1, currentSection + direction));
          if (nextSection !== currentSection)
            selectShortcut(entries.findIndex((item) => item.section === sections[nextSection]));
        } else {
          const scroller = panel.querySelector<HTMLElement>(".semlo-editor-search__quick");
          const row = linksRef.current[selectedRef.current];
          const page = Math.max(1, Math.floor((scroller?.clientHeight ?? 0) / (row?.offsetHeight || 48)) - 1);
          selectShortcut(Math.max(0, Math.min(entries.length - 1, selectedRef.current + direction * page)));
        }
        return;
      }
      if (
        event.target === input &&
        input.value &&
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        !event.shiftKey &&
        ((modifier && !event.altKey) || (event.altKey && !modifier))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const current = panel.querySelector<HTMLElement>(".rp-suggest-item--current");
        const direction = event.key === "ArrowDown" ? 1 : -1;
        let target: HTMLElement | null = null;
        if (modifier) {
          const groups = Array.from(panel.querySelectorAll<HTMLElement>(".rp-search-panel__group"));
          const index = groups.findIndex((group) => group.contains(current));
          const next = Math.max(0, Math.min(groups.length - 1, index + direction));
          if (index >= 0 && next !== index) target = groups[next].querySelector<HTMLElement>(".rp-suggest-item");
        } else {
          const rows = Array.from(panel.querySelectorAll<HTMLElement>(".rp-suggest-item"));
          const index = current ? rows.indexOf(current) : -1;
          const viewport = panel.querySelector<HTMLElement>(".rp-search-panel__results");
          const page = Math.max(1, Math.floor((viewport?.clientHeight ?? 0) / (current?.offsetHeight || 50)) - 1);
          const next = Math.max(0, Math.min(rows.length - 1, index + direction * page));
          if (index >= 0) target = rows[next] ?? null;
        }
        if (target && target !== current) {
          scrollSelection = true;
          target.dispatchEvent(
            new MouseEvent("mouseover", {
              bubbles: true,
              clientX: -1000,
              clientY: -1000,
              detail: PROGRAMMATIC_SELECTION,
            }),
          );
        }
        return;
      }
      if (event.target !== input || event.metaKey || event.ctrlKey || event.altKey) return;
      if (input.value) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") scrollSelection = true;
        else if (event.key === "Enter")
          rememberLink(panel.querySelector<HTMLAnchorElement>(".rp-suggest-item--current .rp-suggest-item__link"));
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const count = shortcutsRef.current.length;
        selectShortcut((selectedRef.current + step + count) % count);
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        linksRef.current[selectedRef.current]?.click();
      }
    };
    const onSearchComplete = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const snapshot = event.detail as SearchSnapshot;
      if (!snapshot || snapshot.query !== input.value || !Array.isArray(snapshot.items)) return;
      snapshots = [...snapshots, snapshot].slice(-5);
      updateResults();
      requestAnimationFrame(updateResults);
    };
    const onResultClick = (event: MouseEvent) => {
      if ((event.type === "click" ? event.button !== 0 : event.button !== 1) || !(event.target instanceof Element))
        return;
      const link = event.target.closest<HTMLAnchorElement>(".rp-suggest-item__link, .semlo-editor-search__quick-link");
      if (link && panel.contains(link)) rememberLink(link);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!actionsOpenRef.current || !(event.target instanceof Element)) return;
      if (!event.target.closest(".semlo-editor-search__actions-menu, .semlo-editor-search__actions-trigger"))
        setActions(false);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (actionsOpenRef.current) {
        if ((!event.movementX && !event.movementY) || !(event.target instanceof Element)) return;
        const option = event.target.closest<HTMLElement>('.semlo-editor-search__actions-menu [role="option"]');
        if (!option || option.getAttribute("aria-disabled") === "true") return;
        const options = Array.from(
          panel.querySelectorAll<HTMLElement>('.semlo-editor-search__actions-menu [role="option"]'),
        );
        const index = options.indexOf(option);
        if (index >= 0 && actionIndexRef.current !== index) {
          actionIndexRef.current = index;
          setActionIndex(index);
        }
        return;
      }
      if (!suppressHoverRef.current || (!event.movementX && !event.movementY)) return;
      suppressHoverRef.current = false;
      if (
        event.target instanceof Element &&
        event.target.closest(".rp-suggest-item, .semlo-editor-search__quick-link")
      ) {
        event.target.dispatchEvent(
          new MouseEvent("mouseover", {
            bubbles: true,
            clientX: event.clientX,
            clientY: event.clientY,
          }),
        );
      }
    };
    const onMouseOver = (event: MouseEvent) => {
      if (event.detail === PROGRAMMATIC_SELECTION) return;
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(".rp-suggest-item, .semlo-editor-search__quick-link")) return;
      if (actionsOpenRef.current || suppressHoverRef.current) event.stopImmediatePropagation();
    };

    input.addEventListener("input", updateInput);
    panel.addEventListener("focusin", updateResults);
    panel.addEventListener("click", onResultClick, true);
    panel.addEventListener("auxclick", onResultClick, true);
    window.addEventListener(SEARCH_COMPLETE_EVENT, onSearchComplete);
    window.addEventListener(COLLECTIONS_CHANGED, updateResults);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("mouseover", onMouseOver, true);
    const observer = new MutationObserver((mutations) => {
      if (
        mutations.some((mutation) => {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          return (
            target?.closest(".rp-search-panel__results") ||
            Array.from(mutation.addedNodes).some(
              (node) => node instanceof Element && node.matches(".rp-search-panel__results"),
            )
          );
        })
      )
        updateResults();
    });
    observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    updateResults();
    void loadSearchResultMetadata().then((index) => {
      if (disposed) return;
      pages = index;
      updateResults();
    });
    return () => {
      disposed = true;
      input.removeEventListener("input", updateInput);
      panel.removeEventListener("focusin", updateResults);
      panel.removeEventListener("click", onResultClick, true);
      panel.removeEventListener("auxclick", onResultClick, true);
      window.removeEventListener(SEARCH_COMPLETE_EVENT, onSearchComplete);
      window.removeEventListener(COLLECTIONS_CHANGED, updateResults);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("mouseover", onMouseOver, true);
      observer.disconnect();
    };
  }, [panel]);

  if (!panel) return null;
  const currentTarget = query ? activeResult : (shortcuts[selected] ?? shortcuts[0]);
  const source = currentTarget?.source && currentTarget.source !== currentTarget.title ? currentTarget.source : "";
  const modifier = /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform) ? "⌘" : "Ctrl";
  const alternate = modifier === "⌘" ? "⌥" : "Alt";
  const actionQuery = actionFilter.trim().toLocaleLowerCase();
  const currentHref = currentTarget ? searchHref(currentTarget.href) : null;
  const favoriteIndex = collections.favorites.findIndex((item) => item.href === currentHref);
  const isFavorite = favoriteIndex >= 0;
  const isRecent = Boolean(!isFavorite && currentHref && collections.recent.some((item) => item.href === currentHref));
  const searchActions: SearchAction[] = [
    { id: "open", title: "打开文档", keywords: "open 打开 文档", section: "文档操作" },
    { id: "new-tab", title: "在新标签页中打开", keywords: "newtab new tab 标签页 新窗口", section: "文档操作" },
    { id: "copy", title: "复制链接", keywords: "copy link url 复制 链接", section: "文档操作" },
    {
      id: "favorite",
      title: isFavorite ? "取消收藏" : "收藏文档",
      keywords: "favorite star pin unpin 收藏",
      section: "快捷访问",
    },
    ...(isFavorite && collections.favorites.length > 1
      ? [
          {
            id: "move-favorite-up",
            title: "向上移动收藏",
            keywords: "move up favorite 上移 收藏 排序",
            section: "快捷访问",
            disabled: favoriteIndex === 0,
          },
          {
            id: "move-favorite-down",
            title: "向下移动收藏",
            keywords: "move down favorite 下移 收藏 排序",
            section: "快捷访问",
            disabled: favoriteIndex === collections.favorites.length - 1,
          },
        ]
      : []),
    ...(isRecent
      ? [{ id: "remove-recent", title: "从最近访问中移除", keywords: "remove recent 移除 最近", section: "快捷访问" }]
      : []),
    ...(collections.recent.length
      ? [{ id: "clear-recent", title: "清空最近访问", keywords: "clear recent 清空 最近", section: "快捷访问" }]
      : []),
  ];
  const visibleActions = searchActions
    .map((action, index) => ({ action, index, score: actionMatchScore(actionQuery, action.title, action.keywords) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((item) => item.action);

  function selectAction(index: number) {
    actionIndexRef.current = index;
    setActionIndex(index);
  }

  async function copyCurrentLink() {
    const link = activeLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.href);
      setActions(false);
      restoreInput();
      setNotice("链接已复制");
    } catch {
      setNotice("复制失败，请检查剪贴板权限");
    }
  }

  function toggleFavorite() {
    const entry = entryForLink(activeLink());
    if (!entry) return;
    const current = collectionsRef.current;
    const exists = current.favorites.some((item) => item.href === entry.href);
    if (!exists && current.favorites.length >= MAX_SEARCH_FAVORITES) {
      setNotice(`最多收藏 ${MAX_SEARCH_FAVORITES} 项`);
      return;
    }
    const favorites = exists
      ? current.favorites.filter((item) => item.href !== entry.href)
      : [entry, ...current.favorites];
    setActions(false);
    const saved = updateCollections({ ...current, favorites });
    restoreInput();
    setNotice(`${exists ? "已取消收藏" : "已收藏"}${saved ? "" : "（未能保存到浏览器）"}`);
  }

  function removeRecent() {
    const entry = entryForLink(activeLink());
    if (!entry) return;
    const current = collectionsRef.current;
    setActions(false);
    const saved = updateCollections({ ...current, recent: current.recent.filter((item) => item.href !== entry.href) });
    restoreInput();
    setNotice(`已从最近访问中移除${saved ? "" : "（未能保存到浏览器）"}`);
  }

  function clearRecent() {
    const current = collectionsRef.current;
    setActions(false);
    const saved = updateCollections({ ...current, recent: [] });
    restoreInput();
    setNotice(`已清空最近访问${saved ? "" : "（未能保存到浏览器）"}`);
  }

  return createPortal(
    <>
      {!query && (
        <div className="semlo-editor-search__quick">
          <div className="semlo-editor-search__quick-list">
            {shortcuts.map((item, index) => (
              <Fragment key={item.href}>
                {(index === 0 || shortcuts[index - 1].section !== item.section) && (
                  <p className="semlo-editor-search__section-label">{item.section}</p>
                )}
                <Link
                  ref={(element) => {
                    linksRef.current[index] = element;
                  }}
                  href={item.href}
                  className="semlo-editor-search__quick-link"
                  data-selected={index === selected || undefined}
                  data-semlo-editor-target={item.targetTitle}
                  data-semlo-editor-source={item.source}
                  onMouseEnter={() => {
                    selectedRef.current = index;
                    setSelected(index);
                  }}
                  onFocus={() => {
                    selectedRef.current = index;
                    setSelected(index);
                  }}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
                    event.stopPropagation();
                    panel
                      .querySelector<HTMLElement>(".rp-search-panel__cancel")
                      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                  }}
                >
                  <span className="semlo-editor-search__quick-icon">
                    <QuickLinkIcon icon={item.icon} />
                  </span>
                  <span className="semlo-editor-search__quick-title">{item.title}</span>
                  <span className="semlo-editor-search__quick-description">{item.description}</span>
                  <span className="semlo-editor-search__quick-enter" aria-hidden="true">
                    ↵
                  </span>
                </Link>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      {query && searching && <div className="semlo-editor-search__loading">正在搜索…</div>}
      {actionsOpen && currentTarget && (
        <div className="semlo-editor-search__actions-menu" role="dialog" aria-label="当前结果操作">
          <label className="semlo-editor-search__action-search">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="m12.2 12.2 3.3 3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              ref={actionInputRef}
              role="combobox"
              aria-label="搜索操作"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="semlo-editor-search-actions"
              aria-activedescendant={
                visibleActions[actionIndex] && !visibleActions[actionIndex].disabled
                  ? `semlo-editor-action-${visibleActions[actionIndex].id}`
                  : undefined
              }
              placeholder="搜索操作…"
              value={actionFilter}
              onChange={(event) => {
                setActionFilter(event.target.value);
                selectAction(0);
              }}
            />
          </label>
          <p
            className="semlo-editor-search__actions-label"
            title={[source, currentTarget.title].filter(Boolean).join(" › ")}
          >
            {source && <span className="semlo-editor-search__actions-source">{source} › </span>}
            {currentTarget.title}
          </p>
          <div
            id="semlo-editor-search-actions"
            ref={actionListRef}
            role="listbox"
            aria-label="可用操作"
            onScroll={updateActionOverflow}
          >
            {visibleActions.map((action, index) => {
              const props = {
                id: `semlo-editor-action-${action.id}`,
                role: "option" as const,
                "aria-label": action.title,
                "aria-selected": index === actionIndex && !action.disabled,
                "aria-disabled": action.disabled || undefined,
                tabIndex: -1,
                onFocus: () => selectAction(index),
              };
              return (
                <Fragment key={action.id}>
                  {!actionQuery && (index === 0 || visibleActions[index - 1].section !== action.section) && (
                    <p className="semlo-editor-search__actions-section" aria-hidden="true">
                      {action.section}
                    </p>
                  )}
                  {action.id === "new-tab" ? (
                    <a
                      {...props}
                      href={currentTarget.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-keyshortcuts={modifier === "⌘" ? "Meta+Enter" : "Control+Enter"}
                      onClick={(event) => {
                        event.stopPropagation();
                        rememberLink(activeLink());
                        setActions(false);
                        panel
                          .querySelector<HTMLElement>(".rp-search-panel__cancel")
                          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                      }}
                    >
                      <span className="semlo-editor-search__action-symbol" aria-hidden="true">
                        ↗
                      </span>
                      <span>{action.title}</span>
                      <kbd>{modifier} ↵</kbd>
                    </a>
                  ) : (
                    <button
                      type="button"
                      {...props}
                      disabled={action.disabled}
                      title={
                        action.disabled
                          ? action.id === "move-favorite-up"
                            ? "已经在最前"
                            : "已经在最后"
                          : action.id === "clear-recent"
                            ? "清空此浏览器中的访问记录，不影响收藏"
                            : undefined
                      }
                      aria-keyshortcuts={
                        action.id === "move-favorite-up" || action.id === "move-favorite-down"
                          ? `${modifier === "⌘" ? "Meta" : "Control"}+${action.id === "move-favorite-up" ? "ArrowUp" : "ArrowDown"}`
                          : undefined
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        if (action.id === "open") {
                          setActions(false);
                          activeLink()?.click();
                        } else if (action.id === "copy") void copyCurrentLink();
                        else if (action.id === "favorite") toggleFavorite();
                        else if (action.id === "remove-recent") removeRecent();
                        else if (action.id === "move-favorite-up") moveFavorite(activeLink(), -1);
                        else if (action.id === "move-favorite-down") moveFavorite(activeLink(), 1);
                        else if (action.id === "clear-recent") clearRecent();
                      }}
                    >
                      <span className="semlo-editor-search__action-symbol" aria-hidden="true">
                        {action.id === "copy"
                          ? "⧉"
                          : action.id === "favorite"
                            ? isFavorite
                              ? "★"
                              : "☆"
                            : action.id === "remove-recent"
                              ? "−"
                              : action.id === "move-favorite-up"
                                ? "↑"
                                : action.id === "move-favorite-down"
                                  ? "↓"
                                  : action.id === "clear-recent"
                                    ? "×"
                                    : "↗"}
                      </span>
                      <span>{action.title}</span>
                      {action.id === "open" && <kbd>↵</kbd>}
                      {action.id === "move-favorite-up" && <kbd>{modifier} ↑</kbd>}
                      {action.id === "move-favorite-down" && <kbd>{modifier} ↓</kbd>}
                    </button>
                  )}
                </Fragment>
              );
            })}
            {!visibleActions.length && <p className="semlo-editor-search__actions-empty">没有匹配的操作</p>}
          </div>
          {moreActions && (
            <div className="semlo-editor-search__actions-more" aria-hidden="true">
              向下查看更多 <span>↓</span>
            </div>
          )}
        </div>
      )}
      <div className="semlo-editor-search__footer">
        <span
          className="semlo-editor-search__footer-brand"
          title={[source, currentTarget?.title].filter(Boolean).join(" › ")}
        >
          {notice || (
            <>
              {source && <span className="semlo-editor-search__footer-source">{source} › </span>}
              {currentTarget?.title || "semlo-editor 文档"}
            </>
          )}
        </span>
        <span
          className="semlo-editor-search__keyboard"
          id="semlo-editor-search-help"
          aria-label={`上下方向键选择，${modifier} 加上下方向键切换分组，${alternate} 加上下方向键逐页选择，回车打开，${modifier} 回车在新标签页打开，${modifier} K 操作，Esc ${query ? "清空" : "关闭"}`}
        >
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选择
          </span>
          {query && (
            <span
              className="semlo-editor-search__group-hint"
              title={`${modifier} ↑↓ 切换分组；${alternate} ↑↓ 逐页选择`}
            >
              <kbd>{modifier}</kbd>
              <kbd>↑↓</kbd> 分组
            </span>
          )}
          <span>
            <kbd>esc</kbd> {query ? "清空" : "关闭"}
          </span>
        </span>
        <button
          type="button"
          className="semlo-editor-search__primary-action"
          disabled={!currentTarget}
          onClick={(event) => {
            event.stopPropagation();
            activeLink()?.click();
          }}
        >
          打开 <kbd>↵</kbd>
        </button>
        <button
          type="button"
          className="semlo-editor-search__actions-trigger"
          aria-haspopup="dialog"
          aria-expanded={actionsOpen}
          disabled={!currentTarget}
          onClick={(event) => {
            event.stopPropagation();
            if (actionsOpenRef.current) {
              setActions(false);
              restoreInput();
            } else setActions(true);
          }}
        >
          操作 <kbd>{modifier} K</kbd>
        </button>
      </div>
      <span className="semlo-editor-search__sr-only" role="status" aria-live="polite" aria-atomic="true">
        {notice ||
          (searching
            ? "正在搜索"
            : query
              ? announcement
              : `${shortcuts[selected]?.section}，当前选择：${shortcuts[selected]?.title}`)}
      </span>
    </>,
    panel,
  );
}
