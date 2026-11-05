import { resolve } from "node:path";

import { defineConfig } from "@rspress/core";

export default defineConfig({
  root: "docs/site",
  themeDir: resolve("docs/theme"),
  title: "semlo-editor",
  description: "semlo-editor 富文本编辑器文档",
  lang: "zh",
  search: { searchHooks: resolve("docs/theme/search-hooks.ts") },
  themeConfig: {
    socialLinks: [
      { icon: "github", mode: "text", content: "暂未开通" },
      { icon: "npm", mode: "text", content: "尚未发布" },
      { icon: "x", mode: "text", content: "暂未开通" },
    ],
  },
  plugins: [
    {
      name: "semlo-editor-search-heading-boundaries",
      modifySearchIndexData(pages) {
        // Rspress 2.1 assigns matches exactly at a heading to the previous section.
        // Point section boundaries at the preceding newline until that is fixed upstream.
        for (const page of pages) {
          if (page.toc.some((heading) => heading.charIndex === 0)) {
            page.content = `\n${page.content}`;
            for (const heading of page.toc) {
              if (heading.charIndex >= 0) heading.charIndex += 1;
            }
          }
          for (const heading of page.toc) {
            if (heading.charIndex > 0 && page.content[heading.charIndex - 1] === "\n") {
              heading.charIndex -= 1;
            }
          }
        }
      },
    },
  ],
});
