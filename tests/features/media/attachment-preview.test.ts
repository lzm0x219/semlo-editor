import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/media/attachment-preview-fixture";

let directory: string, bundle: string, style: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-attachment-preview-"));
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { attachment: resolve("tests/fixtures/media/attachment-preview-fixture.ts") },
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: {
        alias: Object.fromEntries(
          ["core", "react", "vue", "solid"].map((name) => [
            `@semlo-editor/${name}$`,
            resolve(`packages/${name}/dist/index.js`),
          ]),
        ),
      },
      output: { distPath: { root: directory }, cleanDistPath: false, filename: { js: "[name].js" } },
      tools: { rspack: { optimization: { splitChunks: false, runtimeChunk: false } } },
    },
  });
  await build.build();
  bundle = await readInlineFixtureBundle(directory);
  style = await readFile(resolve("packages/core/dist/style.css"), "utf8");
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function mount(
  page: Page,
  mode: "core" | "react" | "vue" | "solid" = "core",
  enabled = true,
  controlled = false,
) {
  await page
    .context()
    .route("https://semlo-preview.invalid/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<p>本地宿主预览夹具</p>" }),
    );
  await page.setContent(
    '<style>body{margin:0}#editor,#second{width:calc(100% - 32px);max-width:900px;margin:64px auto}</style><div id="editor"></div>',
  );
  await page.addStyleTag({ content: style });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ mode, enabled, controlled }) => window.attachmentMount(mode, enabled, controlled), {
    mode,
    enabled,
    controlled,
  });
  await page.waitForFunction(() => Boolean(window.attachmentEditor));
}
const file = (page: Page) => page.locator("#editor .semlo-editor-attachment-view > a[data-semlo-editor-attachment]");
async function select(page: Page) {
  await file(page).click();
  await expect(page.getByRole("toolbar", { name: "附件操作" })).toBeVisible();
}
async function popup(page: Page, action: () => Promise<unknown>) {
  const opened = page.context().waitForEvent("page");
  await action();
  const next = await opened;
  await next.waitForLoadState();
  expect(await next.evaluate(() => window.opener === null)).toBe(true);
  const url = next.url();
  await next.close();
  return url;
}
async function recordNavigation(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { previewOpened: string[] }).previewOpened = [];
    window.open = (url) => {
      (window as unknown as { previewOpened: string[] }).previewOpened.push(String(url));
      return null;
    };
  });
}
async function navigation(page: Page) {
  return page.evaluate(() => (window as unknown as { previewOpened: string[] }).previewOpened);
}

for (const mode of ["core", "react", "vue", "solid"] as const) {
  test(`${mode}: selection and preview use current host without changing controlled content`, async ({ page }) => {
    await mount(page, mode, true, true);
    const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
    await select(page);
    expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(0);
    const url = await popup(page, () => page.getByRole("button", { name: "预览附件" }).click());
    expect(url).toContain("/viewer/a?file=");
    expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
    expect(await page.evaluate(() => window.attachmentChanges)).toBe(0);
    await page.evaluate(() => window.attachmentUpdate("b"));
    const next = await popup(page, () => page.getByRole("button", { name: "预览附件" }).click());
    expect(next).toContain("/viewer/b?file=");
    await page.evaluate(() => window.attachmentUpdate(null));
    const direct = await popup(page, () => page.getByRole("button", { name: "预览附件" }).click());
    expect(direct).toBe("https://semlo-preview.invalid/files/fixture.pdf");
    expect(await page.evaluate(() => document.querySelector("#editor")!.hasAttribute("resolveAttachmentPreview"))).toBe(
      false,
    );
    expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
  });
  test(`${mode}: readonly opens safely and unmount leaves no live attachment callback`, async ({ page }) => {
    await mount(page, mode);
    await page.evaluate(() => window.attachmentReadonly(true));
    expect(await popup(page, () => file(page).click())).toContain("/viewer/a?");
    await page.evaluate(() => {
      const old = document.querySelector(".semlo-editor-attachment-view > a") as HTMLElement;
      window.attachmentDestroy();
      old.click();
    });
    expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(1);
    await expect(page.locator(".semlo-editor-attachment-view")).toHaveCount(0);
  });
}

test("legacy JSON and exported HTML round trip without view controls or preview addresses", async ({ page }) => {
  await mount(page);
  const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  await select(page);
  await popup(page, () => page.getByRole("button", { name: "预览附件" }).click());
  expect(before.html).toContain('data-semlo-editor-attachment=""');
  expect(before.html).not.toMatch(/attachment-tools|预览附件|viewer\/a/);
  await page.evaluate((html) => window.attachmentSetContent(html), before.html);
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
  expect(await page.getByRole("link", { name: "下载附件" }).getAttribute("href")).toBe(
    "https://semlo-preview.invalid/files/fixture.pdf",
  );
  expect(await page.getByRole("link", { name: "下载附件" }).getAttribute("download")).toBe("附件样本.pdf");
});

test("unsafe legacy href remains readable and recoverable but cannot navigate", async ({ page }) => {
  await mount(page);
  await page.evaluate(() =>
    window.attachmentSetContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "semloEditorAttachment",
              attrs: {
                href: "javascript:alert(1)",
                name: "<img src=x onerror=alert(1)>",
                size: 7,
                mimeType: "application/pdf",
              },
            },
          ],
        },
      ],
    }),
  );
  const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  await expect(file(page)).toHaveText("<img src=x onerror=alert(1)>");
  await expect(file(page)).not.toHaveAttribute("href");
  await expect(page.locator(".semlo-editor-attachment-view img")).toHaveCount(0);
  await select(page);
  await expect(page.getByRole("button", { name: "预览附件" })).toBeDisabled();
  expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(0);
  expect(before.html).toContain("data-semlo-editor-original-href");
  await page.evaluate((html) => window.attachmentSetContent(html), before.html);
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
});

test("missing resolver retains direct links and preview does not create an undo item", async ({ page }) => {
  await mount(page, "core", false);
  const original = await page.evaluate(() => window.attachmentEditor.getSnapshot().json);
  await page.evaluate(() => window.attachmentEditor.editor.commands.insertContentAt(1, "正文"));
  await select(page);
  expect(await popup(page, () => page.getByRole("button", { name: "预览附件" }).click())).toBe(
    "https://semlo-preview.invalid/files/fixture.pdf",
  );
  await page.evaluate(() => window.attachmentEditor.editor.commands.undo());
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot().json)).toEqual(original);
});

test("configured empty, invalid, asynchronous and throwing resolvers never fall back to source", async ({ page }) => {
  await mount(page);
  await select(page);
  await recordNavigation(page);
  await page.getByRole("button", { name: "预览附件" }).click();
  expect(await navigation(page)).toHaveLength(1);
  for (const behavior of ["null", "undefined", "unsafe", "promise", "throw"] as const) {
    await page.evaluate((behavior) => {
      window.attachmentBehavior = behavior;
    }, behavior);
    await page.getByRole("button", { name: "预览附件" }).click();
    expect(await navigation(page)).toHaveLength(1);
    await expect(page.getByRole("status")).toBeVisible();
  }
  expect(await page.evaluate(() => window.attachmentErrors)).toEqual([
    "当前附件没有可用的预览",
    "当前附件没有可用的预览",
    "附件预览地址无效",
    "附件预览地址无效",
    "宿主预览失败",
  ]);
});

for (const action of ["destroy", "replace", "provider", "provider-aba", "unmount"] as const) {
  test(`synchronous host ${action} invalidates the old preview activation`, async ({ page }) => {
    await mount(page);
    await select(page);
    await recordNavigation(page);
    await page.getByRole("button", { name: "预览附件" }).click();
    expect(await navigation(page)).toHaveLength(1);
    await page.evaluate((action) => {
      window.attachmentOnResolve = () => {
        if (action === "destroy") window.attachmentDestroy();
        if (action === "replace") window.attachmentEditor.setContent("<p>新文档</p>");
        if (action === "provider") void window.attachmentUpdate("b");
        if (action === "provider-aba") {
          void window.attachmentUpdate(null);
          void window.attachmentUpdate("a");
        }
        if (action === "unmount") window.attachmentEditor.editor.unmount();
      };
    }, action);
    await page.getByRole("button", { name: "预览附件" }).click();
    expect(await navigation(page)).toHaveLength(1);
  });
}

test("keyboard preview and attachment deletion preserve undo and redo", async ({ page }) => {
  await mount(page);
  const before = await page.evaluate(() => window.attachmentEditor.getSnapshot().json);
  await select(page);
  await file(page).focus();
  for (const mode of ["标题", "卡片", "嵌入"]) {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: `附件显示为${mode}`, exact: true })).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "预览附件" })).toBeFocused();
  expect(await popup(page, () => page.keyboard.press("Enter"))).toContain("/viewer/a?");
  await file(page).focus();
  expect(await popup(page, () => page.keyboard.press("Enter"))).toContain("/viewer/a?");
  await select(page);
  await page.keyboard.press("Backspace");
  await expect(file(page)).toHaveCount(0);
  await page.evaluate(() => window.attachmentEditor.editor.commands.undo());
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot().json)).toEqual(before);
  await page.evaluate(() => window.attachmentEditor.editor.commands.redo());
  await expect(file(page)).toHaveCount(0);
});

test("two editors resolve independently and rebuilt raw views remain usable", async ({ page }) => {
  await mount(page);
  const first = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  await page.evaluate(() => window.attachmentCreateSecond());
  await recordNavigation(page);
  await file(page).click();
  await page.locator("#editor").getByRole("button", { name: "预览附件" }).click();
  await page.locator("#second .semlo-editor-attachment-view > a[data-semlo-editor-attachment]").click();
  await page.locator("#second").getByRole("button", { name: "预览附件" }).click();
  expect((await navigation(page)).map((url) => new URL(url).pathname)).toEqual(["/viewer/a", "/viewer/b"]);
  await page.evaluate(() => {
    const editor = window.attachmentEditor.editor;
    editor.unmount();
    const host = document.createElement("div");
    document.querySelector("#editor")!.append(host);
    editor.mount(host);
  });
  await file(page).click();
  await page.locator("#editor").getByRole("button", { name: "预览附件" }).click();
  expect(await navigation(page)).toHaveLength(3);
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(first);
});

test("mobile touch selection keeps long filenames and tools inside the viewport", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 780 } });
  const page = await context.newPage();
  try {
    await mount(page);
    await page.evaluate(() => {
      const data = window.attachmentEditor.getSnapshot().json;
      data.content![0].content![1].attrs!.name = "这是很长的一份附件文件名".repeat(12) + ".pdf";
      window.attachmentEditor.setContent(data);
    });
    await file(page).tap();
    await expect(page.getByRole("button", { name: "预览附件" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bounds = await page.getByRole("toolbar", { name: "附件操作" }).boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await recordNavigation(page);
    await page.getByRole("button", { name: "预览附件" }).tap();
    expect(await navigation(page)).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test("download uses the original file and the host response decides download behavior", async ({ page }) => {
  await mount(page);
  const contents = "%PDF-1.4\n% Semlo download transport fixture\n%%EOF\n";
  await page.context().route("https://semlo-preview.invalid/files/fixture.pdf", (route) =>
    route.fulfill({
      contentType: "application/pdf",
      headers: { "Content-Disposition": 'attachment; filename="fixture.pdf"' },
      body: contents,
    }),
  );
  await select(page);
  const received = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载附件" }).click();
  const download = await received;
  expect(download.suggestedFilename()).toBe("fixture.pdf");
  const stream = await download.createReadStream();
  if (!stream) throw new Error("未收到附件下载流");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe(contents);
  expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(0);
});

test("a short filename at the right edge keeps tools visible through resize", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const data = window.attachmentEditor.getSnapshot().json;
    data.content![0].attrs = { textAlign: "right" };
    data.content![0].content![1].attrs!.name = "a";
    data.content![0].content!.pop();
    window.attachmentEditor.setContent(data);
  });
  await select(page);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForFunction(() => {
    const tools = document.querySelector(".semlo-editor-attachment-tools")!.getBoundingClientRect();
    return tools.left >= 8 && tools.right <= 382;
  });
  const tools = await page.getByRole("toolbar", { name: "附件操作" }).boundingBox();
  expect(tools!.x).toBeGreaterThanOrEqual(8);
  expect(tools!.x + tools!.width).toBeLessThanOrEqual(382);
  await page.getByRole("button", { name: "预览附件" }).focus();
  expect(await popup(page, () => page.keyboard.press("Enter"))).toContain("/viewer/a?");
});

test("selected attachments still move with native drag and retain one-step undo", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const data = window.attachmentEditor.getSnapshot().json;
    data.content!.push({ type: "paragraph", content: [{ type: "text", text: "拖入目标" }] });
    // 目标段仅用于布置夹具，不与待验证的拖动合并为一条历史。
    window.attachmentEditor.editor.chain().setMeta("addToHistory", false).setContent(data).run();
  });
  const before = await page.evaluate(() => window.attachmentEditor.getSnapshot().json);
  await select(page);
  await file(page).dragTo(page.locator("#editor .semlo-editor-prose > p").last());
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot().json)).not.toEqual(before);
  await expect(file(page)).toHaveCount(1);
  await expect(
    page.locator("#editor .semlo-editor-prose > p").last().locator(".semlo-editor-attachment-view"),
  ).toHaveCount(1);
  await page.evaluate(() => window.attachmentEditor.editor.commands.undo());
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot().json)).toEqual(before);
});

test("public content replacement can reuse equal attachment views without losing selection or preview", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    const data = window.attachmentEditor.getSnapshot().json;
    data.content!.push({ type: "paragraph", content: [{ type: "text", text: "新加入的正文" }] });
    window.attachmentEditor.setContent(data);
  });
  const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  await select(page);
  expect(await popup(page, () => page.getByRole("button", { name: "预览附件" }).click())).toContain("/viewer/a?");
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
});
