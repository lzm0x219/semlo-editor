import type { NormalizedSidebarGroup, SidebarData, SidebarItem } from "@rspress/core";
import { useActiveMatcher, useLocation, useSidebarDynamic } from "@rspress/core/runtime";
import { Link } from "@rspress/core/theme-original";
import { useEffect, useId, useRef, useState } from "react";

type Entry = SidebarData[number];
type ExpandedGroups = Record<string, boolean>;

const storageKey = "semlo-editor:docs:sidebar-groups";

function isGroup(item: Entry): item is NormalizedSidebarGroup {
  return "items" in item && Array.isArray(item.items);
}

function PageLink({
  item,
  expanded,
  desktopCollapsed,
}: {
  item: SidebarItem;
  expanded: boolean;
  desktopCollapsed: boolean;
}) {
  const active = useActiveMatcher()(item.link);
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const link = ref.current;
    const sidebar = link?.closest<HTMLElement>(".semlo-editor-manual__sidebar");
    const scroller = sidebar?.querySelector<HTMLElement>("nav");
    if (
      !active ||
      !expanded ||
      !link ||
      !sidebar ||
      !scroller ||
      !scroller.getClientRects().length ||
      getComputedStyle(sidebar).visibility === "hidden"
    )
      return;
    const box = scroller.getBoundingClientRect();
    const position = link.getBoundingClientRect();
    if (position.bottom > box.bottom || position.top < box.top) {
      scroller.scrollTop += position.top - box.top - Math.min(96, box.height / 3);
    }
  }, [active, expanded, desktopCollapsed]);
  return (
    <Link
      ref={ref}
      className={`rp-sidebar-item rp-sidebar-item--group-item${active ? " rp-sidebar-item--active" : ""}`}
      href={item.link}
      aria-current={active ? "page" : undefined}
    >
      <span>{item.text}</span>
    </Link>
  );
}

function Group({
  group,
  index,
  active,
  expanded,
  desktopCollapsed,
  onToggle,
}: {
  group: NormalizedSidebarGroup;
  index: number;
  active: boolean;
  expanded: boolean;
  desktopCollapsed: boolean;
  onToggle: () => void;
}) {
  const contentId = useId();
  return (
    <section className={`semlo-editor-sidebar-group${active ? " semlo-editor-sidebar-group--active" : ""}`}>
      <button
        className="semlo-editor-sidebar-group__toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <span className="semlo-editor-sidebar-group__label">
          <span aria-hidden="true" className="semlo-editor-sidebar-group__number">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="semlo-editor-sidebar-group__title">{group.text}</span>
          {active && !expanded && <span className="semlo-editor-sidebar-group__current">当前</span>}
        </span>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="semlo-editor-sidebar-group__chevron">
          <path d="m4.5 6 3.5 3.5L11.5 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <div id={contentId} inert={!expanded} className="semlo-editor-sidebar-group__items" data-expanded={expanded}>
        <div className="semlo-editor-sidebar-group__items-inner">
          {group.items.map((item) =>
            "link" in item && item.link && !isGroup(item) ? (
              <PageLink key={item.link} item={item} expanded={expanded} desktopCollapsed={desktopCollapsed} />
            ) : null,
          )}
        </div>
      </div>
    </section>
  );
}

export function Sidebar({
  onClose,
  desktopCollapsed = false,
  onToggleDesktop,
}: {
  onClose?: () => void;
  desktopCollapsed?: boolean;
  onToggleDesktop?: () => void;
}) {
  const [items] = useSidebarDynamic();
  const match = useActiveMatcher();
  const { pathname } = useLocation();
  const [expandedGroups, setExpandedGroups] = useState<ExpandedGroups>({});
  const [storageReady, setStorageReady] = useState(false);
  const lastPath = useRef(pathname);
  const groups = items.filter(isGroup);
  const activeGroup = groups.find((group) =>
    group.items.some((item) => "link" in item && Boolean(item.link && match(item.link))),
  );

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        setExpandedGroups(Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "boolean")));
      }
    } catch {
      // Browsing remains usable when session storage is unavailable.
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    const name = activeGroup?.text;
    if (!storageReady || lastPath.current === pathname || !name) return;
    lastPath.current = pathname;
    setExpandedGroups((current) => (current[name] === true ? current : { ...current, [name]: true }));
  }, [activeGroup?.text, pathname, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(expandedGroups));
    } catch {
      // A storage restriction must not block navigation.
    }
  }, [expandedGroups, storageReady]);

  const isExpanded = (group: NormalizedSidebarGroup, state = expandedGroups) =>
    state[group.text] ?? (!group.collapsed || group.text === activeGroup?.text);

  return (
    <>
      <div className="semlo-editor-manual__sidebar-heading">
        <strong>文档目录</strong>
        {onToggleDesktop && (
          <button
            type="button"
            className="semlo-editor-sidebar__collapse"
            aria-label={desktopCollapsed ? "展开文档导航" : "收起文档导航"}
            aria-expanded={!desktopCollapsed}
            aria-controls="manual-navigation-sections"
            title={desktopCollapsed ? "展开文档导航" : "收起文档导航"}
            onClick={onToggleDesktop}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <rect x="2.75" y="3.5" width="14.5" height="13" rx="2" />
              <path d="M7.5 3.5v13" />
              <path d={desktopCollapsed ? "m10.5 8 2 2-2 2" : "m13 8-2 2 2 2"} />
            </svg>
          </button>
        )}
        {onClose && (
          <button
            type="button"
            className="semlo-editor-manual__panel-close"
            aria-label="关闭文档导航"
            onClick={onClose}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5 5 15" />
            </svg>
          </button>
        )}
      </div>
      <nav id="manual-navigation-sections" aria-label="文档导航" inert={desktopCollapsed}>
        {groups.map((group, index) => (
          <Group
            key={group.text}
            group={group}
            index={index}
            active={group.text === activeGroup?.text}
            expanded={isExpanded(group)}
            desktopCollapsed={desktopCollapsed}
            onToggle={() => setExpandedGroups((current) => ({ ...current, [group.text]: !isExpanded(group, current) }))}
          />
        ))}
      </nav>
    </>
  );
}
