import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type {} from "../../fixtures/browser/core-source-entry";
import { startCoreSourceServer } from "../../fixtures/browser/core-source-server";

let server: Awaited<ReturnType<typeof startCoreSourceServer>>;
beforeAll(async () => {
  server = await startCoreSourceServer();
});
afterAll(async () => server.stop());

test("embed and bookmark null attributes remain null through HTML", async ({ page }) => {
  await page.goto(server.origin);
  const result = await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = window.semloSourceCreateEditor({
      element: host,
      content: {
        type: "doc",
        content: [
          { type: "semloEditorEmbed", attrs: { provider: null, url: null, draft: null } },
          {
            type: "semloEditorEmbedBookmarkBlock",
            attrs: { provider: null, url: null, title: null, description: null, iconUrl: null },
          },
          {
            type: "paragraph",
            content: [
              {
                type: "semloEditorEmbedBookmarkInline",
                attrs: { provider: null, url: null, title: null, description: null, iconUrl: null },
              },
            ],
          },
        ],
      },
    });
    const before = editor.getSnapshot();
    editor.setContent(before.html);
    const after = editor.getSnapshot();
    editor.destroy();
    return { before: before.json, after: after.json };
  });
  expect(result.after).toEqual(result.before);
});
