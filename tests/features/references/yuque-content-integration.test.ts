import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { createInlineFixtureRsbuild, readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/references/yuque-content-fixture";
import { readEditorStyles } from "../../fixtures/shared/editor-styles";

let directory: string, bundle: string, styles: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-public-interactive-"));
  const builder = await createInlineFixtureRsbuild(
    "integration",
    resolve("tests/fixtures/references/yuque-content-fixture.ts"),
    directory,
    { framework: true },
  );
  await builder.build();
  bundle = await readInlineFixtureBundle(directory);
  styles = [
    readEditorStyles(),
    await readFile(resolve("packages/core/src/features/blocks/actions/block-actions.css"), "utf8"),
  ].join("\n");
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(page: Page, mode: "core" | "react" | "vue" | "solid", enabled = true) {
  await page.route("https://example.invalid/embed/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>预览内容</p>" }),
  );
  await page.setContent('<div id="editor" style="width:900px;margin:100px"></div>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ mode, enabled }) => window.yuqueMount(mode, enabled), { mode, enabled });
  await page.waitForFunction(() => Boolean(window.yuqueEditor));
}
async function openPicker(page: Page) {
  await page.getByRole("button", { name: "插入内容" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="yuque"]').click();
  await expect(page.getByRole("dialog", { name: "语雀内容" })).toBeVisible();
}
for (const mode of ["core", "react", "vue", "solid"] as const) {
  test(`${mode} inserts a host-resolved reference and restores it from HTML`, async ({ page }) => {
    await mount(page, mode);
    await openPicker(page);
    await page.getByLabel("搜索文档或表格").fill("demo");
    await page.getByRole("button", { name: "确定", exact: true }).click();
    await page.getByRole("button", { name: "文档：测试文档" }).click();
    await expect(page.getByRole("dialog", { name: "语雀内容" })).toHaveCount(0);
    const snapshot = await page.evaluate(() => window.yuqueEditor!.getSnapshot());
    expect(snapshot.html).toContain('href="https://example.invalid/doc"');
    expect(snapshot.text).toContain("测试文档");
    await page.evaluate((html) => window.yuqueEditor!.setContent(html), snapshot.html);
    expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).html).toContain(
      'href="https://example.invalid/doc"',
    );
    await page.evaluate(() => window.yuqueDestroy());
  });
}
test("reference switches presentation, preserves HTML and releases an old host preview", async ({ page }) => {
  await mount(page, "core");
  await openPicker(page);
  await page.getByLabel("搜索文档或表格").fill("demo");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.getByRole("button", { name: "文档：测试文档" }).click();
  const reference = page.locator(".semlo-editor-content-reference");
  const frame = reference.locator("iframe");
  await expect(reference).toHaveAttribute("data-display-mode", "embedded");
  await expect(frame).toHaveAttribute("src", "https://example.invalid/embed/doc");
  await reference.locator(".semlo-editor-content-reference-link").click();
  await reference.getByRole("button", { name: "内容显示为卡片" }).click();
  await expect(reference).toHaveAttribute("data-display-mode", "card");
  await expect(frame).toHaveCount(0);
  await reference.getByRole("button", { name: "内容显示为标题" }).click();
  await expect(reference).toHaveAttribute("data-display-mode", "title");
  await page.evaluate(() => window.yuqueEditor!.editor.commands.undo());
  await expect(reference).toHaveAttribute("data-display-mode", "card");
  await page.evaluate(() => window.yuqueEditor!.editor.commands.redo());
  await expect(reference).toHaveAttribute("data-display-mode", "title");
  await reference.locator(".semlo-editor-content-reference-link").click();
  await reference.getByRole("button", { name: "内容显示为嵌入" }).click();
  const resize = reference.getByRole("separator", { name: "调整内容预览高度" });
  await resize.focus();
  await page.keyboard.press("ArrowDown");
  await expect(resize).toHaveAttribute("aria-valuenow", "470");
  await page.evaluate(() => window.yuqueEditor!.editor.commands.undo());
  await expect(resize).toHaveAttribute("aria-valuenow", "460");
  await page.evaluate(() => window.yuqueEditor!.editor.commands.redo());
  await expect(resize).toHaveAttribute("aria-valuenow", "470");
  const saved = await page.evaluate(() => window.yuqueEditor!.getSnapshot());
  await page.evaluate((html) => window.yuqueEditor!.setContent(html), saved.html);
  expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).json).toEqual(saved.json);
  await expect(frame).toHaveAttribute("src", "https://example.invalid/embed/doc");
  await page.evaluate(() => window.yuqueReplace(false));
  await expect(frame).toHaveCount(0);
  await expect(reference.getByRole("status")).toHaveText("无法预览，请打开原文");
  await page.evaluate(() => window.yuqueReplace(true));
  await expect(frame).toHaveAttribute("src", "https://example.invalid/embed/doc");
  await reference.locator(".semlo-editor-content-reference-link").click();
  await reference.getByRole("button", { name: "转换为链接" }).click();
  await expect(reference).toHaveCount(0);
  await expect(page.locator("#editor .semlo-editor-prose a", { hasText: "测试文档" })).toHaveAttribute(
    "href",
    "https://example.invalid/doc",
  );
  await page.evaluate(() => window.yuqueEditor!.editor.commands.undo());
  await expect(reference).toHaveAttribute("data-display-mode", "embedded");
});
test("without a provider the entry stays disabled", async ({ page }) => {
  await mount(page, "core", false);
  await page.getByRole("button", { name: "插入内容" }).click();
  await expect(
    page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="yuque"]'),
  ).toBeDisabled();
});
test("preview origin access requires explicit host configuration and rejects the host origin", async ({ page }) => {
  await page.route("http://semlo-preview.test/", (route) => route.fulfill({ contentType: "text/html", body: "" }));
  await page.goto("http://semlo-preview.test/");
  await mount(page, "core");
  await page.route("https://example.invalid/embed/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<body><script>try { sessionStorage.setItem("semlo-test", "ok"); document.body.textContent = "存储可用"; } catch { document.body.textContent = "存储不可用"; }</script></body>',
    }),
  );
  await openPicker(page);
  await page.getByRole("button", { name: "文档：测试文档" }).click();
  const reference = page.locator(".semlo-editor-content-reference");
  const frame = reference.locator("iframe");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-popups");
  await expect(page.frameLocator(".semlo-editor-content-reference iframe").locator("body")).toHaveText("存储不可用");
  const before = await page.evaluate(() => window.yuqueEditor!.getSnapshot().json);
  await page.evaluate(() => window.yuquePreview({ url: "https://example.invalid/embed/doc", allowSameOrigin: true }));
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-same-origin");
  await expect(page.frameLocator(".semlo-editor-content-reference iframe").locator("body")).toHaveText("存储可用");
  expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).json).toEqual(before);
  await page.evaluate(() => window.yuquePreview({ url: "http://semlo-preview.test/other", allowSameOrigin: true }));
  await expect(frame).toHaveCount(0);
  await expect(reference.getByRole("status")).toHaveText("无法安全预览，请打开原文");
  await page.evaluate(() => {
    window.yuqueEditor!.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "semloEditorContentReference",
              attrs: {
                id: "doc",
                title: "语雀文档",
                href: "https://www.yuque.com/user/book/doc",
                kind: "document",
              },
            },
          ],
        },
      ],
    });
    window.yuquePreview(null);
  });
  await expect(frame).toHaveCount(0);
  await expect(reference.getByRole("status")).toHaveText("语雀预览需要宿主配置，请打开原文");
});
test("keyboard selects a recent content result", async ({ page }) => {
  await mount(page, "core");
  await openPicker(page);
  const input = page.getByLabel("搜索文档或表格");
  const result = page.getByRole("button", { name: "文档：测试文档" });
  await expect(result).toBeVisible();
  await input.press("ArrowDown");
  await expect(result).toBeFocused();
  await result.press("Enter");
  await expect(page.locator(".semlo-editor-content-reference")).toContainText("测试文档");
});
test("inserting a reference in a paragraph keeps surrounding text in separate blocks and is undoable", async ({
  page,
}) => {
  await mount(page, "core");
  await page.evaluate(() => {
    window.yuqueEditor!.setContent("<p>前文后文</p>");
    window.yuqueEditor!.editor.commands.setTextSelection(3);
    window.yuqueEditor!.editor.commands.focus();
  });
  const before = await page.evaluate(() => window.yuqueEditor!.getSnapshot());
  await openPicker(page);
  await page.getByRole("button", { name: "文档：测试文档" }).click();
  const after = await page.evaluate(() => window.yuqueEditor!.getSnapshot());
  expect(after.json.content!.map((block) => block.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
  expect(after.json.content![0].content![0].text).toBe("前文");
  expect(after.json.content![1].content![0].type).toBe("semloEditorContentReference");
  expect(after.json.content![2].content![0].text).toBe("后文");
  await page.evaluate(() => window.yuqueEditor!.editor.commands.undo());
  expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).json).toEqual(before.json);
});
test("removing the provider closes and cancels the active picker", async ({ page }) => {
  await mount(page, "core");
  await openPicker(page);
  await page.getByLabel("搜索文档或表格").fill("pending");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.waitForFunction(() => window.yuquePending.length === 1);
  await page.evaluate(() => window.yuqueReplace(false));
  expect(await page.evaluate(() => window.yuquePending[0].signal.aborted)).toBe(true);
  await expect(page.getByRole("dialog", { name: "语雀内容" })).toHaveCount(0);
  await page.evaluate(() =>
    window.yuquePending[0].resolve([
      { id: "old", title: "旧结果", href: "https://example.invalid/old", kind: "document" },
    ]),
  );
  expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).text).not.toContain("旧结果");
});
test("changing a pending search into a link immediately cancels the old request", async ({ page }) => {
  await mount(page, "core");
  await openPicker(page);
  const input = page.getByLabel("搜索文档或表格");
  await input.fill("pending");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.waitForFunction(() => window.yuquePending.length === 1);
  await input.fill("https://example.invalid/table");
  expect(await page.evaluate(() => window.yuquePending[0].signal.aborted)).toBe(true);
  await page.evaluate(() =>
    window.yuquePending[0].resolve([
      { id: "old", title: "旧结果", href: "https://example.invalid/old", kind: "document" },
    ]),
  );
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator(".semlo-editor-content-reference")).toContainText("测试表格");
  await expect(page.getByRole("button", { name: "文档：旧结果" })).toHaveCount(0);
});
test("unsafe host links are not offered for insertion", async ({ page }) => {
  await mount(page, "core");
  await openPicker(page);
  await page.getByLabel("搜索文档或表格").fill("unsafe");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("没有找到内容");
  expect(await page.getByRole("button", { name: "文档：不安全" }).count()).toBe(0);
});

test("slash input is replaced only after choosing a result", async ({ page }) => {
  await mount(page, "core");
  await page.locator("#editor .semlo-editor-prose p").click();
  await page.keyboard.type("/yq");
  await page.locator('.semlo-editor-slash-menu .semlo-editor-card-item[data-command="yuque"]').click();
  expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).text).toContain("/yq");
  await page.getByLabel("搜索文档或表格").fill("https://example.invalid/table");
  await page.getByRole("button", { name: "确定" }).click();
  const snapshot = await page.evaluate(() => window.yuqueEditor!.getSnapshot());
  expect(snapshot.text).not.toContain("/yq");
  expect(snapshot.text).toContain("测试表格");
  expect(snapshot.html).toContain('href="https://example.invalid/table"');
});

test("a document change closes the picker without inserting a stale result", async ({ page }) => {
  await mount(page, "core");
  await openPicker(page);
  await page.getByLabel("搜索文档或表格").fill("pending");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.waitForFunction(() => window.yuquePending.length === 1);
  await page.evaluate(() => window.yuqueEditor!.editor.commands.insertContent("改变"));
  await expect(page.getByRole("dialog", { name: "语雀内容" })).toHaveCount(0);
  expect(await page.evaluate(() => window.yuquePending[0].signal.aborted)).toBe(true);
});

test("block-below inserts a saved reference only after the host choice", async ({ page }) => {
  await mount(page, "core");
  await page.evaluate(() => window.yuqueEditor!.setContent("<p>原块</p><p>后块</p>"));
  await page.locator("#editor .semlo-editor-prose p").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  const before = await page.evaluate(() => JSON.stringify(window.yuqueEditor!.getSnapshot().json));
  await page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="yuque"]').click();
  expect(await page.evaluate(() => JSON.stringify(window.yuqueEditor!.getSnapshot().json))).toBe(before);
  await page.getByLabel("搜索文档或表格").fill("demo");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.getByRole("button", { name: "文档：测试文档" }).click();
  const snapshot = await page.evaluate(() => window.yuqueEditor!.getSnapshot());
  expect(snapshot.text).toContain("测试文档");
  expect(snapshot.html).toContain('href="https://example.invalid/doc"');
  expect(snapshot.json.content!.map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
});

for (const mode of ["core", "react", "vue", "solid"] as const) {
  test(`${mode} controlled replacement closes and cancels stale picker work`, async ({ page }) => {
    await mount(page, mode);
    await openPicker(page);
    await page.getByLabel("搜索文档或表格").fill("pending");
    await page.getByRole("button", { name: "确定", exact: true }).click();
    await page.waitForFunction(() => window.yuquePending.length === 1);
    await page.evaluate(() => window.yuqueSetContent("<p>受控替换</p>"));
    await expect(page.getByRole("dialog", { name: "语雀内容" })).toHaveCount(0);
    expect(await page.evaluate(() => window.yuquePending[0].signal.aborted)).toBe(true);
    await page.evaluate(() =>
      window.yuquePending[0].resolve([
        { id: "old", title: "旧结果", href: "https://example.invalid/old", kind: "document" },
      ]),
    );
    expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).text).toContain("受控替换");
    expect((await page.evaluate(() => window.yuqueEditor!.getSnapshot())).text).not.toContain("旧结果");
  });
}
