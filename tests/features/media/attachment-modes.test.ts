import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/media/attachment-modes-fixture";

let directory: string, bundle: string, style: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-attachment-modes-"));
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { attachmentModes: resolve("tests/fixtures/media/attachment-modes-fixture.ts") },
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

const viewer =
  '<body><p>本地宿主阅读页</p><script>document.body.dataset.ready="true";try{parent.document.body.dataset.frameEscaped="yes"}catch{}</script></body>';
async function mount(page: Page, framework: "core" | "react" | "vue" | "solid" = "core", controlled = true) {
  await page.context().route("https://semlo-host.invalid/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: new URL(route.request().url()).pathname.startsWith("/viewer")
        ? viewer
        : '<style>body{margin:0}#editor,#second{width:calc(100% - 32px);max-width:900px;margin:64px auto}</style><div id="editor"></div>',
    }),
  );
  await page
    .context()
    .route("https://semlo-preview.invalid/**", (route) => route.fulfill({ contentType: "text/html", body: viewer }));
  await page.goto("https://semlo-host.invalid/editor");
  await page.addStyleTag({ content: style });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ framework, controlled }) => window.attachmentMount(framework, true, controlled), {
    framework,
    controlled,
  });
  await page.waitForFunction(() => Boolean(window.attachmentEditor));
}
const root = (page: Page) => page.locator("#editor .semlo-editor-attachment-view");
const file = (page: Page) => root(page).locator(":scope > a[data-semlo-editor-attachment]");
const frame = (page: Page) => root(page).locator("iframe");
const resize = (page: Page) => root(page).getByRole("separator", { name: "调整附件预览高度" });
const modeName = { title: "标题", card: "卡片", embedded: "嵌入" };
async function select(page: Page) {
  await file(page).click();
  await expect(root(page).getByRole("toolbar", { name: "附件操作" })).toBeVisible();
}
async function mode(page: Page, value: keyof typeof modeName) {
  await select(page);
  await root(page)
    .getByRole("button", { name: `附件显示为${modeName[value]}`, exact: true })
    .click();
  await expect(root(page)).toHaveAttribute("data-display-mode", value);
}
async function loaded(page: Page) {
  await expect(frame(page)).toHaveCount(1);
  await expect(page.frameLocator("#editor .semlo-editor-attachment-frame").locator("body")).toHaveAttribute(
    "data-ready",
    "true",
  );
}
async function attrs(page: Page) {
  return page.evaluate(() => window.attachmentEditor.getSnapshot().json.content![0].content![1].attrs!);
}
async function pointerStart(page: Page) {
  await resize(page).scrollIntoViewIfNeeded();
  await resize(page).evaluate((element) =>
    element.addEventListener(
      "pointerdown",
      (event) => {
        window.attachmentModePointer = (event as PointerEvent).pointerId;
      },
      { once: true },
    ),
  );
  const rect = await resize(page).boundingBox();
  if (!rect) throw new Error("未找到附件高度手柄");
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y };
}

for (const framework of ["core", "react", "vue", "solid"] as const) {
  test(`${framework}: modes, height, controlled echo, history and saved HTML use the public packages`, async ({
    page,
  }) => {
    await mount(page, framework);
    const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
    expect((await attrs(page)).displayMode).toBeNull();
    expect((await attrs(page)).previewHeight).toBeNull();
    expect(before.html).not.toMatch(/data-semlo-editor-attachment-(mode|height)/);
    expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(0);
    await expect(root(page)).toContainText("655 B");
    await mode(page, "card");
    const cardBox = await root(page).boundingBox();
    const toolbarBox = await root(page).getByRole("toolbar", { name: "附件操作" }).boundingBox();
    expect(Math.abs(cardBox!.x + cardBox!.width / 2 - toolbarBox!.x - toolbarBox!.width / 2)).toBeLessThan(2);
    await expect(root(page).getByRole("toolbar", { name: "附件操作" }).getByRole("button")).toHaveCount(3);
    expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(0);
    expect((await attrs(page)).displayMode).toBe("card");
    await mode(page, "embedded");
    await loaded(page);
    expect((await frame(page).boundingBox())!.height).toBe(418);
    await resize(page).focus();
    await page.keyboard.press("ArrowDown");
    expect((await attrs(page)).previewHeight).toBe(428);
    const saved = await page.evaluate(() => window.attachmentEditor.getSnapshot());
    await page.evaluate(() => window.attachmentEditor.editor.commands.undo());
    expect((await attrs(page)).previewHeight).toBeNull();
    await page.evaluate(() => window.attachmentEditor.editor.commands.redo());
    expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(saved);
    await page.evaluate((html) => window.attachmentSetContent(html), saved.html);
    expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(saved);
    await mode(page, "title");
    await expect(frame(page)).toHaveCount(0);
    const calls = await page.evaluate(() => window.attachmentCalls.length);
    await select(page);
    expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(calls);
    await page.evaluate((html) => window.attachmentSetContent(html), saved.html);
    await loaded(page);
    expect((await attrs(page)).previewHeight).toBe(428);
    expect((await attrs(page)).href).toBe("https://semlo-preview.invalid/files/fixture.pdf");
    expect((await attrs(page)).name).toBe("附件样本.pdf");
    expect((await attrs(page)).size).toBe(655);
    expect((await attrs(page)).mimeType).toBe("application/pdf");
  });
}

test("attachment download setting survives mode changes, history and HTML while preserving old content", async ({
  page,
}) => {
  await mount(page);
  const legacy = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  expect(legacy.json.content![0].content![1].attrs).not.toHaveProperty("allowDownload");
  expect(legacy.html).not.toContain("data-semlo-editor-attachment-allow-download");
  await mode(page, "card");
  const preference = root(page).getByRole("checkbox", { name: "阅读页可下载" });
  await expect(preference).toBeChecked();
  await preference.uncheck();
  expect((await attrs(page)).allowDownload).toBe(false);
  expect((await page.evaluate(() => window.attachmentEditor.getSnapshot())).html).toContain(
    'data-semlo-editor-attachment-allow-download="false"',
  );
  await page.evaluate(() => window.attachmentEditor.setEditable(false));
  await expect(root(page).locator(".semlo-editor-attachment-inline-actions > a")).toBeHidden();
  await expect(root(page).getByRole("button", { name: "预览附件" })).toBeVisible();
  await page.evaluate(() => window.attachmentEditor.setEditable(true));
  await page.evaluate(() => window.attachmentEditor.editor.commands.undo());
  expect((await attrs(page)).allowDownload).toBeUndefined();
  await select(page);
  await expect(preference).toBeChecked();
  await page.evaluate(() => window.attachmentEditor.editor.commands.redo());
  expect((await attrs(page)).allowDownload).toBe(false);
  await mode(page, "embedded");
  await loaded(page);
  await expect(preference).not.toBeChecked();
  const saved = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  await page.evaluate((html) => window.attachmentSetContent(html), saved.html);
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(saved);
  await page.evaluate(() => window.attachmentEditor.setEditable(false));
  await expect(root(page).locator(".semlo-editor-attachment-inline-actions > a")).toBeHidden();
});

test("persisted title stays idle while a persisted embedded attachment loads once", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.attachmentModeSetup({ displayMode: "title", previewHeight: 498 }));
  await select(page);
  expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(0);
  await expect(frame(page)).toHaveCount(0);
  await page.evaluate(() => window.attachmentModeSetup({ displayMode: "embedded", previewHeight: 498 }));
  await loaded(page);
  expect((await frame(page).boundingBox())!.height).toBe(498);
  expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(1);
  const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  await select(page);
  expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(1);
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
});

test("node view captions override legacy capsules while static exports and narrow layouts remain intact", async ({
  page,
}) => {
  await mount(page);
  const appearance = () =>
    file(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        border: style.borderTopWidth,
        padding: style.paddingLeft,
        background: style.backgroundColor,
        before: getComputedStyle(element, "::before").content,
      };
    });
  expect(await appearance()).toEqual({ border: "0px", padding: "0px", background: "rgba(0, 0, 0, 0)", before: "none" });
  await mode(page, "card");
  expect(await appearance()).toEqual({ border: "0px", padding: "0px", background: "rgba(0, 0, 0, 0)", before: "none" });
  const caption = await root(page).locator(".semlo-editor-attachment-label").boundingBox();
  const size = await root(page).locator(".semlo-editor-attachment-size").boundingBox();
  expect(size!.x - caption!.x - caption!.width).toBeGreaterThanOrEqual(0);
  expect(size!.x - caption!.x - caption!.width).toBeLessThanOrEqual(12);
  const staticStyle = await page.evaluate(() => {
    const prose = document.createElement("div");
    prose.className = "semlo-editor-prose";
    const anchor = document.createElement("a");
    anchor.className = "semlo-editor-attachment";
    anchor.setAttribute("data-semlo-editor-attachment", "");
    anchor.textContent = "静态附件";
    prose.append(anchor);
    document.body.append(prose);
    const result = {
      border: getComputedStyle(anchor).borderTopWidth,
      before: getComputedStyle(anchor, "::before").content,
    };
    prose.remove();
    return result;
  });
  expect(staticStyle.border).toBe("1px");
  expect(staticStyle.before).toContain("▧");
  await page.setViewportSize({ width: 390, height: 780 });
  await page.evaluate(() => window.attachmentModeSetup({ name: "长文件名称".repeat(80) + ".pdf" }));
  await expect(root(page)).toHaveAttribute("data-display-mode", "card");
  const text = await root(page)
    .locator(".semlo-editor-attachment-label")
    .evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
      overflow: getComputedStyle(element).textOverflow,
    }));
  expect(text.scroll).toBeGreaterThan(text.width);
  expect(text.overflow).toBe("ellipsis");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const narrowCaption = await root(page).locator(".semlo-editor-attachment-label").boundingBox();
  const narrowSize = await root(page).locator(".semlo-editor-attachment-size").boundingBox();
  expect(narrowSize!.x).toBeGreaterThanOrEqual(narrowCaption!.x + narrowCaption!.width);
});

test("one pointer gesture previews locally, commits once and has one undo/redo", async ({ page }) => {
  await mount(page);
  await mode(page, "embedded");
  await loaded(page);
  await page.evaluate(() => {
    window.attachmentChanges = 0;
  });
  const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  const start = await pointerStart(page);
  await page.mouse.move(start.x, start.y + 80, { steps: 5 });
  expect((await frame(page).boundingBox())!.height).toBe(498);
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
  expect(await page.evaluate(() => window.attachmentChanges)).toBe(0);
  await page.mouse.up();
  expect((await attrs(page)).previewHeight).toBe(498);
  expect(await page.evaluate(() => window.attachmentChanges)).toBe(1);
  const after = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  await page.evaluate(() => window.attachmentEditor.editor.commands.undo());
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
  await page.evaluate(() => window.attachmentEditor.editor.commands.redo());
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(after);
});

test("keyboard height edits preserve an existing text selection outside the attachment", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.attachmentModeSetup({ displayMode: "embedded" }));
  await loaded(page);
  await page.evaluate(() => window.attachmentEditor.editor.chain().focus().setTextSelection({ from: 1, to: 3 }).run());
  await resize(page).focus();
  await page.keyboard.press("ArrowDown");
  expect((await attrs(page)).previewHeight).toBe(428);
  expect(
    await page.evaluate(() => {
      const selection = window.attachmentEditor.editor.state.selection;
      return {
        from: selection.from,
        to: selection.to,
        text: window.attachmentEditor.editor.state.doc.textBetween(selection.from, selection.to),
      };
    }),
  ).toEqual({ from: 1, to: 3, text: "文件" });
  await page.evaluate(() => window.attachmentEditor.editor.commands.undo());
  expect((await attrs(page)).previewHeight).toBeNull();
});

test("Escape, pointercancel and readonly cancel a resize without saving the preview", async ({ page }) => {
  await mount(page);
  await mode(page, "embedded");
  await loaded(page);
  const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  for (const action of ["escape", "cancel", "readonly"] as const) {
    const start = await pointerStart(page);
    await page.mouse.move(start.x, start.y + 50);
    expect((await frame(page).boundingBox())!.height).toBe(468);
    if (action === "escape") await page.keyboard.press("Escape");
    if (action === "cancel")
      await page.evaluate(() =>
        document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: window.attachmentModePointer })),
      );
    if (action === "readonly") await page.evaluate(() => window.attachmentReadonly(true));
    await page.mouse.up();
    expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
    expect((await frame(page).boundingBox())!.height).toBe(418);
    if (action === "readonly") {
      await expect(resize(page)).toHaveCount(0);
      await page.evaluate(() => window.attachmentReadonly(false));
    }
  }
});

test("provider replacement cancels a gesture and detaches the previous reading page synchronously", async ({
  page,
}) => {
  await mount(page);
  await mode(page, "embedded");
  await loaded(page);
  await page.evaluate(() => {
    window.attachmentModeOldFrame = document.querySelector("#editor iframe")!;
  });
  const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  const start = await pointerStart(page);
  await page.mouse.move(start.x, start.y + 80);
  const removed = await page.evaluate(() => {
    void window.attachmentUpdate("b");
    return !window.attachmentModeOldFrame!.isConnected && !window.attachmentModeOldFrame!.hasAttribute("src");
  });
  expect(removed).toBe(true);
  await page.mouse.up();
  await loaded(page);
  await expect(frame(page)).toHaveAttribute("src", /viewer\/b/);
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
});

test("synchronous resolver ABA and throw remove old frames and require explicit retry", async ({ page }) => {
  await mount(page);
  await mode(page, "embedded");
  await loaded(page);
  await page.evaluate(() => {
    window.attachmentModeOldFrame = document.querySelector("#editor iframe")!;
    window.attachmentOnResolve = () => {
      window.attachmentOnResolve = undefined;
      void window.attachmentUpdate(null);
      void window.attachmentUpdate("a");
      window.attachmentBehavior = "throw";
    };
    void window.attachmentUpdate("b");
  });
  await expect(root(page).getByRole("button", { name: "重新加载附件预览" })).toBeVisible();
  await expect(frame(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.attachmentModeOldFrame!.isConnected)).toBe(false);
  const count = await page.evaluate(() => window.attachmentCalls.length);
  await root(page).getByRole("button", { name: "重新加载附件预览" }).click();
  await expect(frame(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(count + 1);
  await page.evaluate(() => {
    window.attachmentBehavior = "ok";
  });
  await root(page).getByRole("button", { name: "重新加载附件预览" }).click();
  await loaded(page);
  await expect(frame(page)).toHaveAttribute("src", /viewer\/a/);
});

test("same-origin embedded scripts cannot acquire host access, with an unsandboxed positive control", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    const control = document.createElement("iframe");
    control.id = "positive-control";
    control.src = "https://semlo-host.invalid/viewer";
    document.body.append(control);
  });
  await expect(page.locator("body")).toHaveAttribute("data-frame-escaped", "yes");
  await page.evaluate(() => {
    document.querySelector("#positive-control")!.remove();
    delete document.body.dataset.frameEscaped;
    window.attachmentEditor.setIntegrations({ resolveAttachmentPreview: () => "https://semlo-host.invalid/viewer" });
  });
  await mode(page, "embedded");
  await loaded(page);
  const sandbox = await frame(page).getAttribute("sandbox");
  expect(sandbox).toContain("allow-scripts");
  expect(sandbox).not.toContain("allow-same-origin");
  await expect(page.locator("body")).not.toHaveAttribute("data-frame-escaped");
  await page.evaluate(() => window.attachmentUpdate("a"));
  await loaded(page);
  expect(await frame(page).getAttribute("sandbox")).not.toContain("allow-same-origin");
});

test("invalid previews and raw PDF fallback remain recoverable without unsafe or hanging iframes", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    window.attachmentBehavior = "unsafe";
  });
  await mode(page, "embedded");
  await expect(root(page).getByRole("button", { name: "重新加载附件预览" })).toBeVisible();
  await expect(frame(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.attachmentErrors)).toContain("附件预览地址无效");
  await page.evaluate(() => window.attachmentUpdate(null));
  await expect(root(page)).toContainText("此附件暂时无法在文档内预览，可在新页面打开。");
  await expect(frame(page)).toHaveCount(0);
  const opened = page.context().waitForEvent("page");
  await root(page).getByRole("button", { name: "在新页面预览附件" }).click();
  const external = await opened;
  await external.waitForLoadState();
  expect(external.url()).toBe("https://semlo-preview.invalid/files/fixture.pdf");
  await external.close();
});

test("canonical raw document URLs fall back while the same HTML URL remains embeddable", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const data = window.attachmentEditor.getSnapshot().json;
    data.content![0].content![1].attrs = {
      ...data.content![0].content![1].attrs,
      href: "/document.pdf",
      mimeType: "",
      displayMode: "embedded",
    };
    window.attachmentEditor.setIntegrations({
      resolveAttachmentPreview: (info) => new URL(info.href, document.baseURI).href,
    });
    window.attachmentEditor.setContent(data);
  });
  await expect(root(page).getByRole("button", { name: "在新页面预览附件" })).toBeVisible();
  await expect(frame(page)).toHaveCount(0);
  await page.evaluate(() =>
    window.attachmentModeSetup({
      href: "/document.bin",
      name: "文件.bin",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );
  await expect(root(page).getByRole("button", { name: "在新页面预览附件" })).toBeVisible();
  await expect(frame(page)).toHaveCount(0);
  await page.evaluate(() =>
    window.attachmentModeSetup({
      href: "https://semlo-host.invalid/viewer",
      name: "阅读器.html",
      mimeType: "text/html",
    }),
  );
  await loaded(page);
  await expect(frame(page)).toHaveAttribute("src", "https://semlo-host.invalid/viewer");
});

test("a cross-origin viewer redirect cannot promote embedded scripts to the host origin", async ({ page }) => {
  const parent = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      request.url === "/viewer" ? viewer : '<div id="editor" style="max-width:900px;margin:64px auto"></div>',
    );
  });
  await new Promise<void>((resolve) => parent.listen(0, "127.0.0.1", resolve));
  const parentOrigin = `http://127.0.0.1:${(parent.address() as AddressInfo).port}`;
  const redirect = createServer((_request, response) => {
    response.writeHead(302, { Location: `${parentOrigin}/viewer` });
    response.end();
  });
  await new Promise<void>((resolve) => redirect.listen(0, "127.0.0.1", resolve));
  const redirectURL = `http://127.0.0.1:${(redirect.address() as AddressInfo).port}/redirect`;
  try {
    await page.goto(`${parentOrigin}/editor`);
    await page.addStyleTag({ content: style });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => window.attachmentMount("core"));
    await page.evaluate(
      (redirectURL) => window.attachmentEditor.setIntegrations({ resolveAttachmentPreview: () => redirectURL }),
      redirectURL,
    );
    await mode(page, "embedded");
    await loaded(page);
    expect(await page.locator("body").getAttribute("data-frame-escaped")).toBeNull();
  } finally {
    await page.evaluate(() => window.attachmentDestroy());
    await Promise.all(
      [parent, redirect].map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
    );
  }
});

test("unknown JSON presentation values survive HTML and cannot be overwritten by controls", async ({ page }) => {
  await mount(page);
  for (const settings of [
    { displayMode: { future: ["card", { version: 2 }] }, previewHeight: "418" },
    { displayMode: "future\r\n\u0000mode", previewHeight: { future: 500 } },
    { displayMode: "embedded", previewHeight: 700000 },
  ]) {
    await page.evaluate((settings) => window.attachmentModeSetup(settings), settings);
    await expect(root(page)).toHaveAttribute("data-display-mode", "unsupported");
    await expect(frame(page)).toHaveCount(0);
    const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
    await select(page);
    await expect(root(page).getByRole("button", { name: "附件显示为卡片" })).toBeDisabled();
    await page.evaluate(() =>
      document
        .querySelector<HTMLButtonElement>('[data-attachment-mode="card"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
    expect(before.html).not.toContain("[object Object]");
    await page.evaluate((html) => window.attachmentSetContent(html), before.html);
    expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
    expect(await page.evaluate(() => window.attachmentCalls.length)).toBe(0);
  }
});

test("damaged markers and nonserializable presentation values fail without replacing current content", async ({
  page,
}) => {
  await mount(page);
  const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
  for (const html of [
    '<p><a data-semlo-editor-attachment data-semlo-editor-attachment-mode-json="{broken">文件</a></p>',
    '<p><a data-semlo-editor-attachment data-semlo-editor-attachment-height="418px">文件</a></p>',
    '<p><a data-semlo-editor-attachment data-semlo-editor-attachment-mode="card" data-semlo-editor-attachment-mode-json="null">文件</a></p>',
  ]) {
    expect((await page.evaluate((html) => window.attachmentModeTryContent(html), html)).status).toBe("parse-failed");
    expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
    const initial = await page.evaluate((html) => window.attachmentModeInitialFailure(html), html);
    expect(initial.message).not.toBe("");
    expect(initial.cleaned).toBe(true);
  }
  const rejected = await page.evaluate(() => {
    const values: unknown[] = [NaN, () => {}, new Date(), Array(2)];
    return values.map((value) => {
      const data = window.attachmentEditor.getSnapshot().json;
      data.content![0].content![1].attrs!.previewHeight = value;
      return window.attachmentModeTryContent(data).status;
    });
  });
  expect(rejected).toEqual(["parse-failed", "parse-failed", "parse-failed", "parse-failed"]);
  expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
});

for (const action of ["readonly", "provider", "reject"] as const) {
  test(`host ${action} during mode submission cannot commit the stale attributes`, async ({ page }) => {
    await mount(page);
    const before = await page.evaluate(() => window.attachmentEditor.getSnapshot());
    await select(page);
    await page.evaluate((action) => window.attachmentModeBefore(action), action);
    await root(page).getByRole("button", { name: "附件显示为卡片" }).click();
    expect(await page.evaluate(() => window.attachmentEditor.getSnapshot())).toEqual(before);
    await expect(root(page)).toHaveAttribute("data-display-mode", "title");
  });
}

test("embedded instances and raw unmount/remount own separate iframes and resize resources", async ({ page }) => {
  await mount(page);
  await mode(page, "embedded");
  await loaded(page);
  await page.evaluate(() => {
    window.attachmentCreateSecond();
    const data = window.attachmentSecond.getSnapshot().json;
    data.content![0].content![1].attrs!.displayMode = "embedded";
    window.attachmentSecond.setContent(data);
  });
  await expect(page.locator("#second iframe")).toHaveCount(1);
  await expect(page.locator("#second iframe")).toHaveAttribute("src", /viewer\/b/);
  await page.evaluate(() => {
    window.attachmentModeOldFrame = document.querySelector("#editor iframe")!;
    window.attachmentEditor.editor.unmount();
  });
  expect(await page.evaluate(() => window.attachmentModeOldFrame!.isConnected)).toBe(false);
  await expect(page.locator("#second iframe")).toHaveCount(1);
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.querySelector("#editor")!.append(host);
    window.attachmentEditor.editor.mount(host);
  });
  await loaded(page);
  await page.evaluate(() => window.attachmentEditor.destroy());
  await expect(page.locator("#editor iframe")).toHaveCount(0);
  await expect(page.locator("#second iframe")).toHaveCount(1);
  await page.evaluate(() => window.attachmentSecond.destroy());
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("touch height gesture commits once and stays within a narrow viewport", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 780 } });
  const page = await context.newPage();
  try {
    await mount(page);
    await file(page).tap();
    await root(page).getByRole("button", { name: "附件显示为嵌入" }).tap();
    await loaded(page);
    await resize(page).scrollIntoViewIfNeeded();
    const handle = await resize(page).boundingBox();
    if (!handle) throw new Error("未找到触屏高度手柄");
    const x = handle.x + handle.width / 2,
      y = handle.y + handle.height / 2;
    const client = await context.newCDPSession(page);
    await page.evaluate(() => {
      window.attachmentChanges = 0;
    });
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 60 }] });
    expect((await attrs(page)).previewHeight).toBeNull();
    expect((await frame(page).boundingBox())!.height).toBe(478);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect((await attrs(page)).previewHeight).toBe(478);
    expect(await page.evaluate(() => window.attachmentChanges)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.attachmentEditor.editor.commands.undo());
    expect((await attrs(page)).previewHeight).toBeNull();
  } finally {
    await context.close();
  }
});
