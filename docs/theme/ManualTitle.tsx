import { useFrontmatter, useSite } from "@rspress/core/runtime";
import { LlmsContainer, LlmsCopyButton, Tag } from "@rspress/core/theme-original";
import type { ComponentPropsWithoutRef } from "react";

import { ManualViewOptions } from "./ManualViewOptions";

/** Keep Rspress title actions and tags while giving the reading page a proper title region. */
export function ManualTitle({ className, children, ...props }: ComponentPropsWithoutRef<"h1">) {
  const { frontmatter } = useFrontmatter();
  const { site } = useSite();
  const llmsUI = site?.themeConfig?.llmsUI;
  const placement = typeof llmsUI === "object" ? (llmsUI?.placement ?? "title") : "title";

  return (
    <header className="semlo-editor-doc-title">
      <h1 className={["rp-toc-include", className].filter(Boolean).join(" ")} {...props}>
        {children} <Tag tag={frontmatter.tag} />
      </h1>
      {import.meta.env.ENABLE_LLMS_UI && placement === "title" && (
        <LlmsContainer>
          <LlmsCopyButton />
          <ManualViewOptions />
        </LlmsContainer>
      )}
    </header>
  );
}
