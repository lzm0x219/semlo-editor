import { useI18n, useLang, useSite } from "@rspress/core/runtime";
import {
  copyToClipboard,
  IconAnthropic,
  IconDown,
  IconExternalLink,
  IconLink,
  IconOpenAI,
  SvgWrapper,
  useMdUrl,
} from "@rspress/core/theme-original";
import { useEffect, useId, useRef, useState } from "react";

/** Rspress's view-options trigger has no accessible name; keep its actions in an accessible popover. */
export function ManualViewOptions() {
  const { site } = useSite();
  const lang = useLang();
  const t = useI18n();
  const { pathname } = useMdUrl();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const llmsUI = site?.themeConfig?.llmsUI;
  const configured = typeof llmsUI === "object" ? llmsUI?.viewOptions : undefined;
  const options = configured === false ? [] : (configured ?? ["markdownLink", "chatgpt", "claude"]);
  const label = lang.startsWith("zh") ? "更多文档操作" : "More document actions";
  const markdownUrl = origin ? new URL(pathname, origin).toString() : pathname;
  const query = `Read ${markdownUrl}, I want to ask questions about it.`;

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function closeAndFocus() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  if (!options.length) return null;

  return (
    <div
      className="semlo-editor-doc-menu"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          closeAndFocus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="rp-llms-button semlo-editor-doc-menu__trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <SvgWrapper
          icon={IconDown}
          className={open ? "semlo-editor-doc-menu__arrow is-open" : "semlo-editor-doc-menu__arrow"}
        />
      </button>
      {open && (
        <div id={menuId} className="semlo-editor-doc-menu__items" role="group" aria-label={label}>
          {options.map((option) => {
            if (option === "markdownLink") {
              return (
                <button
                  key={option}
                  type="button"
                  className="semlo-editor-doc-menu__item"
                  onClick={() => {
                    void copyToClipboard(markdownUrl);
                    closeAndFocus();
                  }}
                >
                  <SvgWrapper icon={IconLink} />
                  {t("copyMarkdownLinkText")}
                </button>
              );
            }
            const isChatGPT = option === "chatgpt";
            const name = isChatGPT ? "ChatGPT" : "Claude";
            const href = isChatGPT
              ? `https://chatgpt.com/?${new URLSearchParams({ hints: "search", q: query })}`
              : `https://claude.ai/new?${new URLSearchParams({ q: query })}`;
            return (
              <a
                key={option}
                className="semlo-editor-doc-menu__item"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeAndFocus}
              >
                <SvgWrapper icon={isChatGPT ? IconOpenAI : IconAnthropic} />
                {t("openInText", { name })}
                <SvgWrapper icon={IconExternalLink} className="semlo-editor-doc-menu__external" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
