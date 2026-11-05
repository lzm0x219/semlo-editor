import { useFrontmatter, useLocation } from "@rspress/core/runtime";
import { DocContent, DocFooter, Outline, Overview, useWatchToc } from "@rspress/core/theme-original";
import type { DocLayout as OriginalDocLayout } from "@rspress/core/theme-original";
import { useEffect, useRef, useState, type ComponentProps } from "react";

import { CodeOverflow } from "./CodeOverflow";
import { DocContext } from "./DocContext";
import { ManualTitle } from "./ManualTitle";
import { Sidebar } from "./Sidebar";

import "./manual.css";
import "./reading.css";

type Props = ComponentProps<typeof OriginalDocLayout>;

const sidebarCollapsedKey = "semlo-editor:docs:sidebar-collapsed";

declare global {
  interface ImportMeta {
    readonly env: { readonly SSG_MD?: boolean; readonly ENABLE_LLMS_UI?: boolean };
  }
}

export function DocLayout({ components }: Props) {
  const { frontmatter } = useFrontmatter();
  const { pathname, hash } = useLocation();
  const { rspressDocRef } = useWatchToc();
  const [panel, setPanel] = useState<"navigation" | "outline" | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarStorageReady, setSidebarStorageReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const outlineButton = useRef<HTMLButtonElement>(null);
  const previousPath = useRef(pathname);
  const showSidebar = frontmatter.sidebar !== false && frontmatter.sidebar !== "placeholder";
  const showOutline = frontmatter.outline !== false && !frontmatter.overview;

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    try {
      setSidebarCollapsed(sessionStorage.getItem(sidebarCollapsedKey) === "true");
    } catch {
      // The sidebar remains usable when session storage is unavailable.
    }
    setSidebarStorageReady(true);
  }, []);
  useEffect(() => {
    if (!sidebarStorageReady) return;
    try {
      sessionStorage.setItem(sidebarCollapsedKey, String(sidebarCollapsed));
    } catch {
      // Keep the current choice in memory when storage is unavailable.
    }
  }, [sidebarCollapsed, sidebarStorageReady]);
  useEffect(() => {
    if (previousPath.current !== pathname && panel === "navigation") {
      setPanel(null);
      requestAnimationFrame(() => {
        const heading = document.querySelector<HTMLElement>(".semlo-editor-manual__main h1");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus({ preventScroll: true });
      });
    }
    previousPath.current = pathname;
  }, [pathname, panel]);
  useEffect(() => {
    if (hash) setPanel(null);
  }, [hash]);
  useEffect(() => {
    function onResize() {
      if ((panel === "navigation" && window.innerWidth >= 768) || (panel === "outline" && window.innerWidth >= 1200)) {
        setPanel(null);
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [panel]);
  useEffect(() => {
    if (!panel) return;
    const previousOverflow = document.body.style.overflow;
    const header = document.querySelector<HTMLElement>(".rp-nav");
    const headerWasInert = header?.inert;
    const panelElement = document.getElementById(panel === "navigation" ? "manual-navigation" : "manual-outline");
    document.body.style.overflow = "hidden";
    if (header) header.inert = true;

    const focusableElements = () =>
      Array.from(
        panelElement?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]') ?? [],
      ).filter(
        (element) =>
          !element.closest("[inert]") &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden",
      );

    const focusFrame = requestAnimationFrame(() => {
      const available = focusableElements();
      const candidates =
        panel === "navigation"
          ? [
              panelElement?.querySelector<HTMLElement>('[aria-current="page"]'),
              panelElement?.querySelector<HTMLElement>(
                ".semlo-editor-sidebar-group--active .semlo-editor-sidebar-group__toggle",
              ),
            ]
          : [panelElement?.querySelector<HTMLElement>(".rp-toc-item--active")];
      const preferredFocus = candidates.find((candidate) => candidate && available.includes(candidate)) ?? available[0];
      const scroller = panelElement?.querySelector<HTMLElement>("nav");
      if (panel === "navigation" && scroller && preferredFocus && scroller.contains(preferredFocus)) {
        const container = scroller.getBoundingClientRect();
        const target = preferredFocus.getBoundingClientRect();
        if (target.bottom > container.bottom - 12) scroller.scrollTop += target.bottom - container.bottom + 12;
        if (target.top < container.top + 12) scroller.scrollTop -= container.top + 12 - target.top;
      }
      preferredFocus?.focus({ preventScroll: true });
    });

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPanel(null);
        requestAnimationFrame(() => (panel === "navigation" ? menuButton : outlineButton).current?.focus());
      }
      if (event.key === "Tab") {
        const elements = focusableElements();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && (document.activeElement === first || !panelElement?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !panelElement?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (header && headerWasInert !== undefined) header.inert = headerWasInert;
    };
  }, [panel]);

  function closePanel() {
    const trigger = panel === "navigation" ? menuButton : outlineButton;
    setPanel(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  function selectOutlineTarget(event: React.MouseEvent<HTMLElement>) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (panel !== "outline" || !link) return;
    setPanel(null);
    requestAnimationFrame(() => {
      const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if (target) {
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      } else {
        outlineButton.current?.focus();
      }
    });
  }

  if (import.meta.env.SSG_MD) {
    return frontmatter.overview ? (
      <Overview content={<DocContent components={components} isOverviewPage />} />
    ) : (
      <DocContent components={components} />
    );
  }

  return (
    <div className="semlo-editor-manual">
      <div className="semlo-editor-manual__mobile-bar" inert={Boolean(panel)}>
        {showSidebar && (
          <button
            ref={menuButton}
            type="button"
            className="semlo-editor-manual__navigation-trigger"
            aria-expanded={panel === "navigation"}
            aria-controls="manual-navigation"
            onClick={() => setPanel(panel === "navigation" ? null : "navigation")}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>{" "}
            文档导航
          </button>
        )}
        {showOutline && (
          <button
            ref={outlineButton}
            type="button"
            aria-expanded={panel === "outline"}
            aria-controls="manual-outline"
            onClick={() => setPanel(panel === "outline" ? null : "outline")}
          >
            本页目录{" "}
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m7 4 6 6-6 6" />
            </svg>
          </button>
        )}
      </div>
      {panel && (
        <button
          type="button"
          className="semlo-editor-manual__scrim"
          aria-label="关闭面板"
          tabIndex={-1}
          onClick={closePanel}
        />
      )}
      <div className={`semlo-editor-manual__layout${showSidebar && sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
        {showSidebar && (
          <aside
            id="manual-navigation"
            className={`semlo-editor-manual__sidebar${panel === "navigation" ? " is-open" : ""}`}
            role={panel === "navigation" ? "dialog" : undefined}
            aria-modal={panel === "navigation" ? true : undefined}
            aria-label={panel === "navigation" ? "文档导航" : undefined}
            inert={panel === "outline"}
            onClick={(event) => {
              const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
              if (panel === "navigation" && link && new URL(link.href).pathname === window.location.pathname)
                closePanel();
            }}
          >
            <Sidebar
              onClose={closePanel}
              desktopCollapsed={sidebarCollapsed}
              onToggleDesktop={() => setSidebarCollapsed((collapsed) => !collapsed)}
            />
          </aside>
        )}
        <main className="semlo-editor-manual__main" inert={Boolean(panel)}>
          <div className="semlo-editor-manual__article">
            <DocContext />
            {frontmatter.overview ? (
              <Overview content={<DocContent components={components} isOverviewPage />} />
            ) : (
              <div className="rp-doc rspress-doc" ref={rspressDocRef}>
                <DocContent components={{ h1: ManualTitle, ...components }} />
              </div>
            )}
            {mounted && <CodeOverflow />}
            {frontmatter.footer !== false && <DocFooter />}
          </div>
        </main>
        {showOutline && (
          <aside
            id="manual-outline"
            className={`semlo-editor-manual__outline${panel === "outline" ? " is-open" : ""}`}
            role={panel === "outline" ? "dialog" : undefined}
            aria-modal={panel === "outline" ? true : undefined}
            aria-label="本页目录"
            inert={panel === "navigation"}
            onClick={selectOutlineTarget}
          >
            {panel === "outline" && (
              <button
                type="button"
                className="semlo-editor-manual__panel-close"
                aria-label="关闭本页目录"
                onClick={closePanel}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 5l10 10M15 5 5 15" />
                </svg>
              </button>
            )}
            {/* Rspress uses this class to keep active-heading scrolling inside the outline. */}
            <div className="rp-doc-layout__outline semlo-editor-manual__toc-boundary">
              <Outline />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
