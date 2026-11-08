import { expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/list/task-item-conversion-fixture";

declare global {
  interface Window {
    headingAnchorScrolls?: string[];
    resolveHeadingAnchorClipboard?: () => void;
    secondHeadingAnchorEditor?: import("../../../packages/core/src/types").EditorController;
  }
}

let origin = "";
let stop = async () => {};
test.beforeAll(async () => {
  const rsbuild = await createFixtureRsbuild("./tests/fixtures/list/task-item-conversion-fixture.ts", {
    publicDir: false,
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = async () => server.close();
});
test.beforeEach(async ({ page }) => installFixtureGuards(page));
test.afterAll(async () => stop());

async function mount(page: Page, content: string, url = origin) {
  await page.goto(url);
  await page.waitForFunction(() => window.taskConversionCreate);
  await page.evaluate((html) => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: html,
      onChange(snapshot) {
        window.taskConversionEditor?.setContent(snapshot.html);
      },
    });
  }, content);
}

const snapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());

test("复制标题链接后可保存、重载并定位，旧内容不会提前写入标识", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    window.headingAnchorScrolls = [];
    Element.prototype.scrollIntoView = function () {
      window.headingAnchorScrolls?.push(this.textContent ?? "");
    };
  });
  await mount(page, "<h3>测试标题</h3><p>正文</p>", `${origin}/?page=42#route`);
  const before = await snapshot(page);
  expect(before.json.content?.[0].attrs?.semloEditorHeadingAnchor).toBeUndefined();
  expect(before.html).not.toContain("data-semlo-editor-heading-anchor");
  const heading = page.locator(".semlo-editor-prose > h3");
  await heading.hover();
  await page.getByRole("button", { name: "复制 3 级标题的段落链接" }).click();
  await expect(page.getByRole("status")).toHaveText("复制成功");
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  const id = copied.searchParams.get("semlo-heading");
  expect(id).toMatch(/^sh-[a-f0-9-]+$/);
  expect(copied.searchParams.get("page")).toBe("42");
  expect(copied.hash).toBe("#route");
  const saved = await snapshot(page);
  expect(saved.json.content?.[0].attrs?.semloEditorHeadingAnchor).toBe(id);
  expect(saved.html).toContain(`data-semlo-editor-heading-anchor="${id}"`);
  await page.evaluate((html) => window.__semloRequireFixture("taskConversionEditor").setContent(html), saved.html);
  expect((await snapshot(page)).json).toEqual(saved.json);
  await mount(page, saved.html, copied.href);
  await expect
    .poll(() => page.evaluate(() => window.headingAnchorScrolls?.some((text) => text.includes("测试标题"))))
    .toBe(true);
  expect((await snapshot(page)).json).toEqual(saved.json);
});

test("在同一文档粘贴带链接的标题会生成独立标识", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page, "<h3>测试标题</h3><p></p>");
  await page.locator(".semlo-editor-prose > h3").hover();
  await page.getByRole("button", { name: "复制 3 级标题的段落链接" }).click();
  await expect(page.getByRole("status")).toHaveText("复制成功");
  const source = await snapshot(page);
  const id = source.json.content?.[0].attrs?.semloEditorHeadingAnchor;
  const html = await page.evaluate((value) => {
    const template = document.createElement("template");
    template.innerHTML = value;
    return template.content.querySelector("h3")!.outerHTML;
  }, source.html);
  await page.evaluate(async (value) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([value], { type: "text/html" }),
        "text/plain": new Blob(["测试标题"], { type: "text/plain" }),
      }),
    ]);
  }, html);
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = await snapshot(page);
  const headings = pasted.json.content?.filter((node) => node.type === "heading") ?? [];
  expect(headings).toHaveLength(2);
  expect(headings[0].attrs?.semloEditorHeadingAnchor).toBe(id);
  expect(headings[1].attrs?.semloEditorHeadingAnchor).toMatch(/^sh-[a-f0-9-]+$/);
  expect(headings[1].attrs?.semloEditorHeadingAnchor).not.toBe(id);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot(page)).json).toEqual(source.json);
});

test("只读旧标题不因复制链接而修改内容", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page, "<h3>只读标题</h3><p>正文</p>");
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").setEditable(false));
  const before = await snapshot(page);
  await page.locator(".semlo-editor-prose > h3").hover();
  await page.getByRole("button", { name: "复制 3 级标题的段落链接" }).click();
  await expect(page.getByRole("status")).toHaveText("此标题暂无可复制的链接");
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("复制链接不占撤销步骤，已有链接在只读时仍可复制", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page, "<h3>标题</h3><p>正文</p>");
  const heading = page.locator(".semlo-editor-prose > h3");
  await heading.click();
  await page.keyboard.press("End");
  await page.keyboard.type("甲");
  await heading.hover();
  const button = page.getByRole("button", { name: "复制 3 级标题的段落链接" });
  await button.click();
  await expect(page.getByRole("status")).toHaveText("复制成功");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  const id = new URL(url).searchParams.get("semlo-heading");
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  const undone = await snapshot(page);
  expect(undone.json.content?.[0].content?.[0].text).toBe("标题");
  expect(undone.json.content?.[0].attrs?.semloEditorHeadingAnchor).toBe(id);
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").setEditable(false));
  await heading.hover();
  await button.click();
  await expect(page.getByRole("status")).toHaveText("复制成功");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  expect((await snapshot(page)).json).toEqual(undone.json);
});

test("剪贴板失败有反馈，销毁后不处理迟到的结果", async ({ page }) => {
  await mount(page, "<h3>标题</h3><p>正文</p>");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("clipboard failed")) },
    });
  });
  await page.locator(".semlo-editor-prose > h3").hover();
  const button = page.getByRole("button", { name: "复制 3 级标题的段落链接" });
  await button.click();
  await expect(page.getByRole("status")).toHaveText("无法复制段落链接");
  expect((await snapshot(page)).json.content?.[0].content?.[0].text).toBe("标题");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => new Promise<void>((resolve) => (window.resolveHeadingAnchorClipboard = resolve)) },
    });
  });
  await button.click();
  await page.evaluate(() => {
    window.__semloRequireFixture("taskConversionEditor").destroy();
    window.resolveHeadingAnchorClipboard?.();
  });
  await expect(page.locator(".semlo-editor-heading-link-status")).toHaveCount(0);
});

test("拆分标题不复制已有段落链接标识", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page, "<h3>甲乙</h3><p>正文</p>");
  await page.locator(".semlo-editor-prose > h3").hover();
  await page.getByRole("button", { name: "复制 3 级标题的段落链接" }).click();
  await expect(page.getByRole("status")).toHaveText("复制成功");
  const before = await snapshot(page);
  const id = before.json.content?.[0].attrs?.semloEditorHeadingAnchor;
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("taskConversionEditor").editor;
    editor.commands.setTextSelection(2);
    editor.view.focus();
  });
  await page.keyboard.press("Enter");
  const after = await snapshot(page);
  const headings = after.json.content?.filter((node) => node.type === "heading") ?? [];
  expect(headings[0].attrs?.semloEditorHeadingAnchor).toBe(id);
  expect(headings.slice(1).every((node) => node.attrs?.semloEditorHeadingAnchor == null)).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await snapshot(page)).json).toEqual(after.json);
});

test("从标题开头拆分时，原内容保留段落链接", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page, "<h3>甲乙</h3><p>正文</p>");
  await page.locator(".semlo-editor-prose > h3").hover();
  await page.getByRole("button", { name: "复制 3 级标题的段落链接" }).click();
  await expect(page.getByRole("status")).toHaveText("复制成功");
  const before = await snapshot(page);
  const id = before.json.content?.[0].attrs?.semloEditorHeadingAnchor;
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("taskConversionEditor").editor;
    editor.commands.setTextSelection(1);
    editor.view.focus();
  });
  await page.keyboard.press("Enter");
  const after = await snapshot(page);
  const headings = after.json.content?.filter((node) => node.type === "heading") ?? [];
  const linked = headings.filter((node) => node.attrs?.semloEditorHeadingAnchor === id);
  expect(linked).toHaveLength(1);
  expect(linked[0].content?.[0].text).toBe("甲乙");
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await snapshot(page)).json).toEqual(after.json);
});

test("销毁一个编辑器不会影响另一个编辑器的标题链接", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page, "<h3>第一个</h3><p>正文</p>");
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "second-anchor";
    document.body.append(host);
    window.secondHeadingAnchorEditor = window.__semloRequireFixture("taskConversionCreate")({
      element: host,
      outline: false,
      content: "<h3>第二个</h3><p>正文</p>",
    });
  });
  await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").destroy());
  const second = page.locator("#second-anchor .semlo-editor-prose > h3");
  await second.hover();
  await second.getByRole("button", { name: "复制 3 级标题的段落链接" }).click();
  await expect(page.getByRole("status")).toHaveText("复制成功");
  const id = new URL(await page.evaluate(() => navigator.clipboard.readText())).searchParams.get("semlo-heading");
  expect(
    await page.evaluate(
      () =>
        window.__semloRequireFixture("secondHeadingAnchorEditor").getSnapshot().json.content?.[0].attrs
          ?.semloEditorHeadingAnchor,
    ),
  ).toBe(id);
  await page.evaluate(() => window.__semloRequireFixture("secondHeadingAnchorEditor").destroy());
});
