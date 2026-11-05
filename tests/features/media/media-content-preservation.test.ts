import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import type {} from "../../fixtures/browser/core-source-entry";
import { startCoreSourceServer } from "../../fixtures/browser/core-source-server";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

let server: Awaited<ReturnType<typeof startCoreSourceServer>>;
beforeAll(async () => {
  server = await startCoreSourceServer();
});
afterAll(async () => server.stop());

declare global {
  interface Window {
    mediaPreservationEditor?: EditorController;
  }
}

test("attachment and media addresses survive HTML round trips without enabling unsafe URLs", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(server.origin);
  await page.addScriptTag({
    type: "module",
    content: `
      const createEditor = window.semloSourceCreateEditor
      const host = document.createElement('div'); host.id = 'media-preservation'; document.body.prepend(host)
      window.mediaPreservationEditor = createEditor({element: host, outline: false})
    `,
  });
  const values: unknown[] = [
    "/" + "x".repeat(4096),
    "javascript:alert(1)",
    "/\\example.test/file",
    " /文件 ",
    null,
    { future: "地址" },
  ];
  const results = await page.evaluate((inputs) => {
    const editor = window.__semloRequireFixture("mediaPreservationEditor");
    return inputs.map((value) => {
      const content = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "semloEditorAttachment", attrs: { href: value, name: "附件" } }] },
          { type: "semloEditorAudio", attrs: { src: value, name: "音频" } },
          { type: "semloEditorVideo", attrs: { src: value, name: "视频" } },
        ],
      };
      editor.setContent(content);
      const before = editor.getSnapshot();
      editor.setContent(before.html);
      const after = editor.getSnapshot();
      const parsed = new DOMParser().parseFromString(before.html, "text/html");
      return {
        before: [
          before.json.content![0].content![0].attrs!.href,
          before.json.content![1].attrs!.src,
          before.json.content![2].attrs!.src,
        ],
        after: [
          after.json.content![0].content![0].attrs!.href,
          after.json.content![1].attrs!.src,
          after.json.content![2].attrs!.src,
        ],
        link: parsed.querySelector("a[data-semlo-editor-attachment]")?.getAttribute("href") ?? null,
        media: [...parsed.querySelectorAll("audio, video")].map((element) => element.getAttribute("src")),
        html: before.html,
      };
    });
  }, values);
  for (let index = 0; index < values.length; index++) {
    expect(results[index].before).toEqual([values[index], values[index], values[index]]);
    expect(results[index].after).toEqual(results[index].before);
    if (index !== 3) {
      expect(results[index].link).toBeNull();
      expect(results[index].media).toEqual([null, null]);
    }
  }
  expect(results[1].html).not.toContain("javascript:");
  expect(results[2].html).not.toContain("example.test");
});

test("damaged stored media addresses fail without replacing the current document", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(server.origin);
  const result = await page.evaluate(() => {
    const initialHost = document.createElement("div");
    const host = document.createElement("div");
    document.body.append(initialHost, host);
    const errors: string[] = [];
    const damaged = '<p><a data-semlo-editor-attachment data-semlo-editor-original-href="broken">附件</a></p>';
    let initialError = "";
    try {
      window.semloSourceCreateEditor({ element: initialHost, content: damaged });
    } catch (error) {
      initialError = error instanceof Error ? error.message : String(error);
    }
    const editor = window.semloSourceCreateEditor({
      element: host,
      content: "<p>保留原文</p>",
      onError: (error) => errors.push(error.message),
    });
    const before = editor.getSnapshot();
    editor.setContent(damaged);
    const after = editor.getSnapshot();
    editor.destroy();
    return { initialError, errors, before, after, initialShells: initialHost.children.length };
  });
  expect(result.initialError).toContain("媒体地址数据损坏");
  expect(result.initialShells).toBe(0);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("媒体地址数据损坏");
  expect(result.after).toEqual(result.before);
});
