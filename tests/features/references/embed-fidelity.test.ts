import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    embedFidelityEditor?: EditorController;
    embedFrameBefore?: HTMLIFrameElement | null;
  }
}

async function mount(page: Page) {
  await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "CodePen fixture" }));
  await page.route("https://player.bilibili.com/**", (route) =>
    route.fulfill({ status: 200, body: "Bilibili fixture" }),
  );
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: [
      "import { createEditor } from '/dist/index.js'",
      "const host = document.createElement('div')",
      "host.id = 'embed-fidelity-test'",
      "document.body.prepend(host)",
      "window.embedFidelityEditor = createEditor({ element: host, outline: false, content: '<p>第一段</p><p>第二段</p>' })",
    ].join("\n"),
  });
  await page.waitForFunction(() => Boolean(window.embedFidelityEditor));
  return page.locator("#embed-fidelity-test");
}

async function insertFromToolbar(page: Page, name: "哔哩哔哩" | "CodePen") {
  const host = page.locator("#embed-fidelity-test");
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByLabel("搜索插入内容").fill(name);
  await panel.locator(name === "CodePen" ? '[data-command="codepen"]' : '[data-command="bilibili"]').click();
  return host.locator(".semlo-editor-embed").last();
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("long drafts and untrusted original URLs survive HTML, input, and undo", async ({ page }) => {
  const host = await mount(page);
  const draft = "x".repeat(2048) + "终";
  await page.evaluate(
    (value) =>
      window.__semloRequireFixture("embedFidelityEditor").setContent({
        type: "doc",
        content: [
          { type: "semloEditorEmbed", attrs: { provider: "codepen", url: "", draft: value } },
          { type: "semloEditorEmbed", attrs: { provider: "codepen", url: "javascript:alert(1)", draft: "" } },
        ],
      }),
    draft,
  );
  const original = await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").getSnapshot());
  expect(original.json.content?.[0].attrs?.draft).toBe(draft);
  expect(original.html).not.toContain("javascript:");
  expect(original.html).not.toContain("href=");
  await expect(host.locator("iframe")).toHaveCount(0);
  await page.evaluate((html) => window.__semloRequireFixture("embedFidelityEditor").setContent(html), original.html);
  expect((await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").getSnapshot())).json).toEqual(
    original.json,
  );
  const input = host.getByLabel("CodePen链接").first();
  await expect(input).toHaveValue(draft);
  await input.focus();
  await input.fill(draft + "新增");
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").getSnapshot())).json.content?.[0]
      .attrs?.draft,
  ).toBe(draft + "新增");
  await input.press("Enter");
  await expect(host.locator(".semlo-editor-embed").first().getByRole("status")).toBeVisible();
  await expect(input).toHaveValue(draft + "新增");
  expect(await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(input).toHaveValue(draft);
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").getSnapshot())).json.content?.[1]
      .attrs?.url,
  ).toBe("javascript:alert(1)");
  await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").destroy());
});

test("embed form does not submit while its input is composing", async ({ page }) => {
  await mount(page);
  const card = await insertFromToolbar(page, "CodePen");
  const input = card.getByLabel("CodePen链接");
  await input.fill("https://codepen.io/Mamboleoo/pen/XWJPxpZ");
  await input.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    element.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(card.locator("iframe")).toHaveCount(0);
  await input.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await input.press("Enter");
  await expect(card.locator("iframe")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").destroy());
});

test("embed input resets composition when the editor becomes read-only", async ({ page }) => {
  await mount(page);
  const card = await insertFromToolbar(page, "CodePen");
  const input = card.getByLabel("CodePen链接");
  await input.fill("https://codepen.io/Mamboleoo/pen/XWJPxpZ");
  await input.evaluate((element) => {
    element.blur();
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  });
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("embedFidelityEditor");
    api.setEditable(false);
    api.setEditable(true);
  });
  await input.evaluate((element) =>
    element.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await expect(card.locator("iframe")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").destroy());
});

test("embed input resets composition when the surrounding document is replaced", async ({ page }) => {
  await mount(page);
  const card = await insertFromToolbar(page, "CodePen");
  const input = card.getByLabel("CodePen链接");
  await input.fill("https://codepen.io/Mamboleoo/pen/XWJPxpZ");
  await input.evaluate((element) => {
    element.blur();
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  });
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("embedFidelityEditor");
    const json = api.getSnapshot().json;
    api.setContent({
      ...json,
      content: [...(json.content ?? []), { type: "paragraph", content: [{ type: "text", text: "新文档" }] }],
    });
  });
  await input.evaluate((element) =>
    element.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await expect(card.locator("iframe")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").destroy());
});

test("destroying the editor synchronously while submitting an embed does not throw", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  const card = await insertFromToolbar(page, "CodePen");
  const input = card.getByLabel("CodePen链接");
  await input.fill("https://codepen.io/Mamboleoo/pen/XWJPxpZ");
  await page.evaluate(() => {
    const api = window.__semloRequireFixture("embedFidelityEditor");
    api.editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) api.destroy();
    });
  });
  await input.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").editor.isDestroyed)).toBe(true);
  expect(errors).toEqual([]);
});

test("the input validates before loading a frame and supports undo, conversion and deletion", async ({ page }) => {
  const host = await mount(page);
  const card = await insertFromToolbar(page, "CodePen");
  const input = card.getByLabel("CodePen链接");
  await expect(input).toBeFocused();
  await expect(card.locator(".semlo-editor-embed-form")).toHaveCSS("min-height", "50px");
  await input.fill("https://example.com/test");
  await input.press("Enter");
  await expect(card.getByRole("status")).toHaveText("暂不支持显示该网站内容");
  await expect(input).toHaveValue("https://example.com/test");
  await expect(card.locator("iframe")).toHaveCount(0);

  await input.fill("https://codepen.io/afc163-1472555193/pen/oNXqWGP");
  await expect(card.locator("iframe")).toHaveCount(0);
  await input.press("Enter");
  const frame = card.locator("iframe");
  await expect(frame).toHaveAttribute("src", "https://codepen.io/afc163-1472555193/embed/oNXqWGP");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-same-origin");
  await expect(card.locator(".semlo-editor-embed-preview")).toHaveCSS("height", "500px");
  await frame.evaluate((element) => {
    window.embedFrameBefore = element as HTMLIFrameElement;
  });
  await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").editor.commands.focus());
  expect(await frame.evaluate((element) => window.embedFrameBefore === element)).toBe(true);

  expect(await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(input).toHaveValue("https://codepen.io/afc163-1472555193/pen/oNXqWGP");
  await expect(card.locator("iframe")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(frame).toHaveCount(1);
  // Redo restores the node selection, so the selection overlay is already hidden.
  await expect(card).toHaveClass(/is-selected/);
  await expect(card.getByRole("toolbar", { name: "嵌入内容操作" })).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").editor.commands.setTextSelection(1));
  await card.getByRole("button", { name: "选择嵌入内容" }).click();
  const toolbar = card.getByRole("toolbar", { name: "嵌入内容操作" });
  await expect(toolbar.locator("button, a")).toHaveCount(5);
  await expect(toolbar.locator('svg[aria-hidden="true"]')).toHaveCount(5);
  await expect(toolbar).toHaveText("");
  expect(
    await toolbar.locator("button, a").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label"))),
  ).toEqual(["转换为链接", "标题", "卡片", "嵌入", "打开链接"]);
  await expect(toolbar.getByRole("button", { name: "标题" })).toBeDisabled();
  await expect(toolbar.getByRole("button", { name: "卡片" })).toBeDisabled();
  await expect(toolbar.getByRole("button", { name: "嵌入" })).toBeDisabled();
  await expect(toolbar.getByRole("button", { name: "嵌入" })).toHaveAttribute("aria-pressed", "true");
  const toolbarBox = await toolbar.boundingBox();
  const previewBox = await card.locator(".semlo-editor-embed-preview").boundingBox();
  if (!toolbarBox || !previewBox) throw new Error("Missing embed toolbar geometry");
  expect(toolbarBox.width).toBe(195);
  expect(toolbarBox.height).toBe(40);
  expect(Math.abs(toolbarBox.x + toolbarBox.width / 2 - (previewBox.x + previewBox.width / 2))).toBeLessThan(1);
  expect(previewBox.y - (toolbarBox.y + toolbarBox.height)).toBe(8);
  await card.evaluate((element) => (element.style.width = "130px"));
  const narrowToolbar = await toolbar.boundingBox();
  const narrowPreview = await card.locator(".semlo-editor-embed-preview").boundingBox();
  if (!narrowToolbar || !narrowPreview) throw new Error("Missing narrow embed toolbar geometry");
  expect(narrowToolbar.x).toBeGreaterThanOrEqual(narrowPreview.x);
  expect(narrowToolbar.x + narrowToolbar.width).toBeLessThanOrEqual(narrowPreview.x + narrowPreview.width);
  await card.evaluate((element) => (element.style.width = ""));
  await expect(toolbar.getByRole("link", { name: "打开链接" })).toHaveAttribute(
    "href",
    "https://codepen.io/afc163-1472555193/pen/oNXqWGP",
  );
  await toolbar.getByRole("button", { name: "转换为链接" }).click();
  await expect(host.locator(".semlo-editor-embed")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose a")).toHaveAttribute(
    "href",
    "https://codepen.io/afc163-1472555193/embed/oNXqWGP",
  );
  await expect(host.locator(".semlo-editor-prose a")).toHaveText("https://codepen.io/afc163-1472555193/embed/oNXqWGP");
  expect(await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(card.locator("iframe")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").editor.commands.setTextSelection(1));
  await card.getByRole("button", { name: "选择嵌入内容" }).click();
  await page.keyboard.press("Backspace");
  await expect(host.locator(".semlo-editor-embed")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(host.locator(".semlo-editor-embed")).toHaveCount(1);
});

test("slash and insert-below create focused cards at the intended positions", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("embedFidelityEditor").editor;
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
  });
  await host.locator(".semlo-editor-prose p").last().click();
  await page.keyboard.type("/blbl");
  const slash = page.getByRole("listbox", { name: "插入内容" });
  await expect(slash.getByRole("option", { name: /哔哩哔哩/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const first = host.locator(".semlo-editor-embed").first();
  await expect(first.getByLabel("哔哩哔哩链接")).toBeFocused();
  await first.getByRole("button", { name: "查看示例" }).click();
  await expect(first.locator("iframe")).toHaveAttribute(
    "src",
    "https://player.bilibili.com/player.html?aid=55895675&autoplay=0",
  );

  await host.locator(".semlo-editor-prose > p").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('[data-command="codepen"]').click();
  const cards = host.locator(".semlo-editor-embed");
  await expect(cards).toHaveCount(2);
  await expect(cards.first().getByLabel("CodePen链接")).toBeFocused();
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").getSnapshot().json)).content?.map(
      (node) => node.type,
    ),
  ).toEqual(["paragraph", "semloEditorEmbed", "paragraph", "semloEditorEmbed"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator("iframe")).toHaveCount(1);
});

test("HTML and JSON round trips revalidate links and read-only and replacement clean up controls", async ({ page }) => {
  const host = await mount(page);
  const card = await insertFromToolbar(page, "CodePen");
  await card.getByRole("button", { name: "查看示例" }).click();
  const original = await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").getSnapshot());
  expect(original.html).toContain("data-semlo-editor-embed");
  expect(original.html).not.toContain("<iframe");
  for (const content of [original.html, original.json]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("embedFidelityEditor").setContent("<p>临时</p>");
      window.__semloRequireFixture("embedFidelityEditor").setContent(value);
    }, content);
    expect((await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").getSnapshot())).json).toEqual(
      original.json,
    );
    await expect(host.locator(".semlo-editor-embed iframe")).toHaveAttribute(
      "src",
      "https://codepen.io/Mamboleoo/embed/XWJPxpZ",
    );
  }
  await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").setEditable(false));
  await expect(host.locator(".semlo-editor-embed iframe")).toHaveCount(1);
  await expect(host.getByRole("button", { name: "选择嵌入内容" })).toBeHidden();
  await page.evaluate(() =>
    window.__semloRequireFixture("embedFidelityEditor").setContent({
      type: "doc",
      content: [
        { type: "semloEditorEmbed", attrs: { provider: "codepen", url: "https://codepen.io.evil.test/a/pen/b" } },
      ],
    }),
  );
  await expect(host.locator(".semlo-editor-embed iframe")).toHaveCount(0);
  await expect(host.getByLabel("CodePen链接")).toHaveAttribute("readonly", "");
  await expect(host.getByRole("button", { name: "确定" })).toBeDisabled();
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").getSnapshot())).html,
  ).not.toContain("href=");
  await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").setContent("<p>替换内容</p>"));
  await expect(host.locator(".semlo-editor-embed")).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("embedFidelityEditor").destroy());
  await expect(host.locator(".semlo-editor-embed")).toHaveCount(0);
});
