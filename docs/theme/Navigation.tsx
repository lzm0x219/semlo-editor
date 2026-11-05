import type { NavItem, NavItemWithLink } from "@rspress/core";
import { matchNavbar, useLocation, useNav, useSite } from "@rspress/core/runtime";
import { Link, Search, SwitchAppearance, type NavProps } from "@rspress/core/theme-original";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import { ProjectLinks, useGithubStars } from "./ProjectLinks";

const sectionDescriptions: Record<string, string> = {
  指南: "认识、接入与内容集成",
  框架接入: "Vue 3 · React · SolidJS",
  "API 参考": "配置、控制器与组件",
  博客: "开发进展与实践",
};

function isLink(item: NavItem): item is NavItemWithLink {
  return "link" in item && typeof item.link === "string" && typeof item.text === "string";
}

function samePath(link: string, pathname: string) {
  const path =
    link
      .split(/[?#]/, 1)[0]
      .replace(/\.html$/, "")
      .replace(/\/$/, "")
      .replace(/\/index$/, "") || "/";
  const current =
    pathname
      .replace(/\.html$/, "")
      .replace(/\/$/, "")
      .replace(/\/index$/, "") || "/";
  return path === current;
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h9m-3.5-3.5L12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function focusDocument(hash: string) {
  let heading: HTMLElement | null = null;
  if (hash) {
    try {
      heading = document.getElementById(decodeURIComponent(hash.slice(1)));
    } catch {
      // Fall back to the page title if the fragment cannot be decoded.
    }
  }
  heading ??= document.querySelector<HTMLElement>(".semlo-editor-manual__main h1, .semlo-editor-blog h1");
  if (!heading) return;
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}

export function Nav({
  navTitle,
  beforeNavTitle,
  afterNavTitle,
  beforeNavMenu,
  afterNavMenu,
  beforeLeftNavItems,
  afterLeftNavItems,
  beforeRightNavItems,
  afterRightNavItems,
}: NavProps) {
  const { pathname, hash } = useLocation();
  const { site } = useSite();
  const sections = useNav().filter(isLink);
  const projectLinks = site.themeConfig.socialLinks ?? [];
  const stars = useGithubStars(projectLinks);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{ pathname: string; hash: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    const target = pendingFocus.current;
    if (target && samePath(target.pathname, pathname) && target.hash.toLowerCase() === hash.toLowerCase()) {
      pendingFocus.current = null;
      requestAnimationFrame(() => focusDocument(target.hash));
    }
  }, [pathname, hash]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [mobileOpen]);

  useEffect(() => {
    function onResize() {
      if (window.innerWidth > 860) setMobileOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function openMobileSearch() {
    setMobileOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".rp-search-button--mobile")?.click());
  }

  function selectDocument(event: MouseEvent<HTMLAnchorElement>, link: string) {
    setMobileOpen(false);
    pendingFocus.current = null;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = new URL(link, window.location.href);
    if (target.origin !== window.location.origin) return;
    if (samePath(target.pathname, pathname) && target.hash.toLowerCase() === hash.toLowerCase()) {
      requestAnimationFrame(() => focusDocument(target.hash));
    } else {
      pendingFocus.current = { pathname: target.pathname, hash: target.hash };
    }
  }

  return (
    <header className="rp-nav semlo-editor-nav">
      {samePath("/", pathname) && (
        <a className="semlo-editor-skip-home" href="#semlo-editor-heading">
          跳至首页内容
        </a>
      )}
      <div className="semlo-editor-nav__brand">
        {beforeNavTitle}
        {navTitle}
        {afterNavTitle}
      </div>

      <div className="semlo-editor-nav__cluster">
        {beforeNavMenu}
        <nav className="semlo-editor-nav__primary" aria-label="主导航">
          <ul className="semlo-editor-nav__list">
            {beforeLeftNavItems}
            {sections.map((section) => {
              const active = matchNavbar(section, pathname);
              return (
                <li className="semlo-editor-nav__section" data-active={active || undefined} key={section.text}>
                  <Link
                    className="semlo-editor-nav__section-link"
                    href={section.link}
                    aria-current={samePath(section.link, pathname) ? "page" : active ? "location" : undefined}
                    onClick={(event) => selectDocument(event, section.link)}
                  >
                    {section.text}
                  </Link>
                </li>
              );
            })}
            {afterLeftNavItems}
          </ul>
        </nav>

        <div className="semlo-editor-nav__search">
          <Search />
        </div>
        <div className="semlo-editor-nav__actions">
          {beforeRightNavItems}
          {afterRightNavItems}
          <div className="semlo-editor-nav__appearance">
            <SwitchAppearance />
          </div>
          <div className="semlo-editor-nav__social">
            <ProjectLinks links={projectLinks} stars={stars} />
            <span className="semlo-editor-nav__social-status semlo-editor-social-status-all">项目链接暂未开放</span>
            <span className="semlo-editor-nav__social-status semlo-editor-social-status-partial">部分链接未开放</span>
          </div>
          <button
            type="button"
            className="semlo-editor-nav__mobile-trigger"
            aria-label="打开站点导航"
            aria-haspopup="dialog"
            aria-expanded={mobileOpen}
            aria-controls="semlo-editor-mobile-navigation"
            onClick={() => setMobileOpen(true)}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3.5 6h13M3.5 10h13M3.5 14h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {afterNavMenu}
      </div>

      <dialog
        className="semlo-editor-mobile-nav"
        id="semlo-editor-mobile-navigation"
        ref={dialogRef}
        aria-labelledby="semlo-editor-mobile-nav-title"
        onCancel={(event) => {
          event.preventDefault();
          setMobileOpen(false);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            event.stopPropagation();
            openMobileSearch();
          }
        }}
      >
        <div className="semlo-editor-mobile-nav__header">
          <h2 id="semlo-editor-mobile-nav-title">站点导航</h2>
          <button
            type="button"
            ref={closeButtonRef}
            className="semlo-editor-mobile-nav__close"
            aria-label="关闭站点导航"
            onClick={() => setMobileOpen(false)}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <button type="button" className="semlo-editor-mobile-nav__search" onClick={openMobileSearch}>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="m12.2 12.2 3.3 3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>搜索文档</span>
        </button>
        <nav className="semlo-editor-mobile-nav__content" aria-label="站点导航">
          <ul className="semlo-editor-mobile-nav__list">
            {sections.map((section) => {
              const active = matchNavbar(section, pathname);
              return (
                <li className="semlo-editor-mobile-nav__section" data-active={active || undefined} key={section.text}>
                  <Link
                    className="semlo-editor-mobile-nav__section-link"
                    href={section.link}
                    aria-current={samePath(section.link, pathname) ? "page" : active ? "location" : undefined}
                    onClick={(event) => selectDocument(event, section.link)}
                  >
                    <span className="semlo-editor-mobile-nav__section-label">
                      <span className="semlo-editor-mobile-nav__section-title">
                        {section.text}
                        {active && <span className="semlo-editor-mobile-nav__current">当前栏目</span>}
                      </span>
                      <small>{sectionDescriptions[section.text]}</small>
                    </span>
                    <ArrowRight />
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            className="semlo-editor-mobile-nav__directory"
            href="/documentation"
            aria-current={samePath("/documentation", pathname) ? "page" : undefined}
            onClick={(event) => selectDocument(event, "/documentation")}
          >
            查看全部文档 <ArrowRight />
          </Link>
        </nav>
        <div className="semlo-editor-mobile-nav__footer">
          <div className="semlo-editor-mobile-nav__social">
            <ProjectLinks links={projectLinks} stars={stars} />
            <span className="semlo-editor-mobile-nav__social-status semlo-editor-social-status-all">
              项目链接暂未开放
            </span>
            <span className="semlo-editor-mobile-nav__social-status semlo-editor-social-status-partial">
              部分链接未开放
            </span>
          </div>
          <div className="semlo-editor-mobile-nav__appearance">
            <span>深色模式</span>
            <SwitchAppearance />
          </div>
        </div>
      </dialog>
    </header>
  );
}
