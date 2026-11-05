import { Layout as OriginalLayout, Link } from "@rspress/core/theme-original";
import type { ComponentProps } from "react";

import { AccessibleAppearance } from "./AccessibleAppearance";
import { AccessibleNavControls } from "./AccessibleNavControls";
import { SearchExperience } from "./SearchExperience";

import "./nav.css";
import "./navigation.css";
import "./sidebar.css";
import "./search.css";

export * from "@rspress/core/theme-original";
export { Nav } from "./Navigation";
export { Sidebar } from "./Sidebar";
export { DocLayout } from "./DocLayout";

function Brand() {
  return (
    <Link className="semlo-editor-nav-brand" href="/" aria-label="semlo-editor 主页">
      <svg className="semlo-editor-nav-symbol" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path
          d="M13.8 24.5C13.8 19.2 13.9 14.3 14.3 8.4"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
        <path
          d="M14.1 16.8C8.7 16.6 5.1 13.4 5.2 8.5C10.2 8.6 13.5 11.7 14.1 16.8Z"
          fill="currentColor"
          opacity=".58"
        />
        <path d="M14.2 13.5C14.1 8.2 17.4 5 22 5C22 9.8 18.9 13.1 14.2 13.5Z" fill="currentColor" opacity=".85" />
      </svg>
      <span className="semlo-editor-nav-wordmark">
        semlo-editor<span>.</span>
      </span>
      <span className="semlo-editor-nav-brand-label">开发文档</span>
    </Link>
  );
}

export function Layout(props: ComponentProps<typeof OriginalLayout>) {
  return (
    <>
      <OriginalLayout {...props} navTitle={<Brand />} />
      <AccessibleAppearance />
      <AccessibleNavControls />
      <SearchExperience />
    </>
  );
}
