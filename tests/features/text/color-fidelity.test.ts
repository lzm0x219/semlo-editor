import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    colorFidelityEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'color-fidelity-test'
      document.body.prepend(host)
      window.colorFidelityEditor = createEditor({ element: host, outline: false, content: '<p>前选中文字后</p>' })
      window.colorFidelityEditor.editor.commands.focus()
      window.colorFidelityEditor.editor.commands.setTextSelection({ from: 2, to: 6 })
    `,
  });
  await page.waitForFunction(() => Boolean(window.colorFidelityEditor));
  return page.locator("#color-fidelity-test");
}

async function selectText(page: Page) {
  await page.evaluate(() => {
    window.__semloRequireFixture("colorFidelityEditor").editor.commands.focus();
    window.__semloRequireFixture("colorFidelityEditor").editor.commands.setTextSelection({ from: 2, to: 6 });
  });
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("color boards show the reference palette, selected swatches and separate defaults", async ({ page }) => {
  const host = await mount(page);
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  let palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  await expect(palette).toBeVisible();
  expect((await palette.boundingBox())!.width).toBe(256);
  await expect(palette.locator(".semlo-editor-palette-grid button")).toHaveCount(70);
  await expect(palette.getByRole("button", { name: "深灰 3 #262626" })).toHaveAttribute("aria-pressed", "true");
  await expect(palette.getByText("渐变色", { exact: true })).toBeVisible();
  await expect(palette.locator(".semlo-editor-color-gradients button")).toHaveCount(4);
  await expect(palette.getByText("暂无", { exact: true })).toBeVisible();
  await palette.getByRole("button", { name: "红色 #df2a3f" }).click();
  await expect(palette).toHaveCount(0);
  const selected = host.locator(".semlo-editor-prose span").filter({ hasText: "选中文字" });
  await expect(selected).toHaveCSS("color", "rgb(223, 42, 63)");
  await expect(host.locator(".semlo-editor-prose")).toHaveText("前选中文字后");
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  await expect(palette.getByRole("button", { name: "红色 #df2a3f" })).toHaveAttribute("aria-pressed", "true");
  await palette.getByRole("button", { name: "默认文字颜色" }).click();
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("colorFidelityEditor").getSnapshot().html)).includes(
      "color:",
    ),
  ).toBe(false);

  await selectText(page);
  await host.getByRole("button", { name: "高亮颜色", exact: true }).click();
  palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  await expect(palette.getByRole("button", { name: "无填充色" })).toBeVisible();
  await expect(palette.getByText("渐变色", { exact: true })).toHaveCount(0);
  await palette.getByRole("button", { name: "浅蓝 1 #d9eafc" }).click();
  await expect(host.locator(".semlo-editor-prose mark")).toHaveCSS("background-color", "rgb(217, 234, 252)");
});

test("text gradients preserve unrelated marks, undo and round-trip through HTML and JSON", async ({ page }) => {
  const host = await mount(page);
  await host.getByRole("button", { name: "高亮颜色", exact: true }).click();
  await page
    .getByRole("dialog", { name: "选择颜色", exact: true })
    .getByRole("button", { name: "浅蓝 1 #d9eafc" })
    .click();
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  await palette.getByRole("button", { name: /渐变色 1 / }).click();
  const gradient = host.locator(".semlo-editor-prose span[data-semlo-editor-gradient]");
  await expect(gradient).toHaveText("选中文字");
  await expect(gradient).toHaveCSS("background-image", "linear-gradient(90deg, rgb(42, 188, 191), rgb(56, 54, 221))");
  await expect(host.locator(".semlo-editor-prose mark")).toHaveCSS("background-color", "rgb(217, 234, 252)");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("colorFidelityEditor").getSnapshot());
  expect(snapshot.html).toContain("data-semlo-editor-gradient");
  expect(snapshot.html).toContain("-webkit-text-fill-color");
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate((next) => {
      window.__semloRequireFixture("colorFidelityEditor").setContent("<p>临时内容</p>");
      window.__semloRequireFixture("colorFidelityEditor").setContent(next);
    }, content);
    await expect(host.locator(".semlo-editor-prose span[data-semlo-editor-gradient]")).toHaveText("选中文字");
    await expect(host.locator(".semlo-editor-prose mark")).toHaveCSS("background-color", "rgb(217, 234, 252)");
    expect((await page.evaluate(() => window.__semloRequireFixture("colorFidelityEditor").getSnapshot())).json).toEqual(
      snapshot.json,
    );
  }
  await selectText(page);
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  await page
    .getByRole("dialog", { name: "选择颜色", exact: true })
    .getByRole("button", { name: "红色 #df2a3f" })
    .click();
  await expect(host.locator(".semlo-editor-prose span[data-semlo-editor-gradient]")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose mark")).toHaveCSS("background-color", "rgb(217, 234, 252)");
  await page.evaluate(() => window.__semloRequireFixture("colorFidelityEditor").editor.commands.undo());
  await expect(host.locator(".semlo-editor-prose span[data-semlo-editor-gradient]")).toHaveText("选中文字");
  await page.evaluate(() => window.__semloRequireFixture("colorFidelityEditor").editor.commands.redo());
  await expect(host.locator(".semlo-editor-prose span[data-semlo-editor-gradient]")).toHaveCount(0);
});

test("custom RGBA changes the selected background live without losing input focus", async ({ page }) => {
  const host = await mount(page);
  await host.getByRole("button", { name: "高亮颜色", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  await palette.getByRole("button", { name: "更多颜色" }).click();
  const custom = page.getByRole("dialog", { name: "自定义颜色" });
  const input = custom.getByLabel("HEX", { exact: true });
  await input.fill("#0a78cc");
  await expect(input).toBeFocused();
  await expect(custom).toBeVisible();
  await expect(host.locator(".semlo-editor-prose mark")).toHaveCSS("background-color", "rgb(10, 120, 204)");
  await custom.getByLabel("A", { exact: true }).fill("50");
  await expect(custom.getByLabel("A", { exact: true })).toBeFocused();
  await expect(host.locator(".semlo-editor-prose mark")).toHaveCSS("background-color", "rgba(10, 120, 204, 0.5)");
  await page.keyboard.press("Escape");
  await expect(custom).toHaveCount(0);
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("button", { name: "自定义颜色 rgba(10, 120, 204, 0.5)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("colorFidelityEditor").editor.commands.undo());
  await expect(host.locator(".semlo-editor-prose mark")).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("colorFidelityEditor").editor.commands.redo());
  await expect(host.locator(".semlo-editor-prose mark")).toHaveCSS("background-color", "rgba(10, 120, 204, 0.5)");
  await host.getByRole("button", { name: "高亮颜色", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "选择颜色", exact: true })
      .getByRole("button", { name: "自定义颜色 rgba(10, 120, 204, 0.5)" }),
  ).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("colorFidelityEditor").destroy());
  await expect(page.locator(".semlo-editor-palette, .semlo-editor-color-custom")).toHaveCount(0);
});

test("custom color history is shared between background and text panels", async ({ page }) => {
  const host = await mount(page);
  await host.getByRole("button", { name: "高亮颜色", exact: true }).click();
  let palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  await palette.getByRole("button", { name: "更多颜色" }).click();
  await page.getByRole("dialog", { name: "自定义颜色" }).getByLabel("HEX", { exact: true }).fill("#0a78cc");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  const recent = palette.getByRole("button", { name: "自定义颜色 #0a78cc" });
  await expect(recent).toBeVisible();
  await recent.click();
  await expect(host.locator(".semlo-editor-prose span").filter({ hasText: "选中文字" })).toHaveCSS(
    "color",
    "rgb(10, 120, 204)",
  );
  await expect(host.locator(".semlo-editor-prose mark")).toHaveCSS("background-color", "rgb(10, 120, 204)");
});

test("color history loads and updates the shared storage key", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate(() => {
    localStorage.setItem("semlo-editor:custom-colors:shared", JSON.stringify(["#0a78cc"]));
  });
  const host = await mount(page);
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  const history = palette.locator(".semlo-editor-color-history");
  await expect(history.getByRole("button")).toHaveCount(1);
  await expect(history.getByRole("button", { name: "自定义颜色 #0a78cc" })).toBeVisible();
  await palette.getByRole("button", { name: "更多颜色" }).click();
  await page.getByRole("dialog", { name: "自定义颜色" }).getByLabel("HEX", { exact: true }).fill("#445566");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("semlo-editor:custom-colors:shared") ?? "[]"),
  );
  expect(stored).toEqual(["#445566", "#0a78cc"]);
});

for (const storageAvailable of [true, false]) {
  test(`custom history is shared across editor bundles ${storageAvailable ? "with" : "without"} storage`, async ({
    page,
  }) => {
    if (!storageAvailable) {
      await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() {
            throw new Error("storage unavailable");
          },
        });
      });
    }
    const host = await mount(page);
    const demoColor = page.locator("#editor-host").getByRole("button", { name: "文字颜色", exact: true });
    await demoColor.click();
    let palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
    await expect(palette.getByText("暂无", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await selectText(page);
    await host.getByRole("button", { name: "高亮颜色", exact: true }).click();
    palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
    await palette.getByRole("button", { name: "更多颜色" }).click();
    await page.getByRole("dialog", { name: "自定义颜色" }).getByLabel("HEX", { exact: true }).fill("#0a78cc");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await demoColor.click();
    palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
    await expect(palette.getByRole("button", { name: "自定义颜色 #0a78cc" })).toBeVisible();
  });
}

test("custom color history refreshes across tabs after either editor has opened it", async ({ page }) => {
  const second = await page.context().newPage();
  try {
    const firstHost = await mount(page);
    const secondHost = await mount(second);
    await firstHost.getByRole("button", { name: "文字颜色", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "选择颜色", exact: true }).getByText("暂无")).toBeVisible();
    await page.keyboard.press("Escape");
    await secondHost.getByRole("button", { name: "文字颜色", exact: true }).click();
    await expect(second.getByRole("dialog", { name: "选择颜色", exact: true }).getByText("暂无")).toBeVisible();
    await second.keyboard.press("Escape");
    await firstHost.getByRole("button", { name: "高亮颜色", exact: true }).click();
    await page.getByRole("dialog", { name: "选择颜色", exact: true }).getByRole("button", { name: "更多颜色" }).click();
    await page.getByRole("dialog", { name: "自定义颜色" }).getByLabel("HEX", { exact: true }).fill("#0a78cc");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await secondHost.getByRole("button", { name: "文字颜色", exact: true }).click();
    await expect(
      second.getByRole("dialog", { name: "选择颜色", exact: true }).getByRole("button", { name: "自定义颜色 #0a78cc" }),
    ).toBeVisible();
  } finally {
    await second.close();
  }
});

test("custom color history retains in-memory changes when storage writes are denied", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("semlo-editor:custom-colors:shared", JSON.stringify(["#112233"]));
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "semlo-editor:custom-colors:shared") throw new Error("storage write denied");
      return original.call(this, key, value);
    };
  });
  const host = await mount(page);
  await host.getByRole("button", { name: "高亮颜色", exact: true }).click();
  let palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  await palette.getByRole("button", { name: "更多颜色" }).click();
  await page.getByRole("dialog", { name: "自定义颜色" }).getByLabel("HEX", { exact: true }).fill("#0a78cc");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  await expect(palette.getByRole("button", { name: "自定义颜色 #0a78cc" })).toBeVisible();
  await expect(palette.getByRole("button", { name: "自定义颜色 #112233" })).toBeVisible();
});

test("a caret applies the chosen color to typing and default removes it", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => window.__semloRequireFixture("colorFidelityEditor").editor.commands.setTextSelection(2));
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  await page
    .getByRole("dialog", { name: "选择颜色", exact: true })
    .getByRole("button", { name: "红色 #df2a3f" })
    .click();
  await page.keyboard.type("X");
  await expect(host.locator(".semlo-editor-prose span").filter({ hasText: "X" })).toHaveCSS(
    "color",
    "rgb(223, 42, 63)",
  );
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  await page
    .getByRole("dialog", { name: "选择颜色", exact: true })
    .getByRole("button", { name: "默认文字颜色" })
    .click();
  await page.keyboard.type("Y");
  await expect(host.locator(".semlo-editor-prose")).toHaveText("前XY选中文字后");
  await expect(host.locator(".semlo-editor-prose span").filter({ hasText: "Y" })).toHaveCount(0);
});

test("the editor setColor command replaces an existing gradient", async ({ page }) => {
  const host = await mount(page);
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  await page
    .getByRole("dialog", { name: "选择颜色", exact: true })
    .getByRole("button", { name: /渐变色 1 / })
    .click();
  await expect(host.locator(".semlo-editor-prose span[data-semlo-editor-gradient]")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("colorFidelityEditor").editor.commands.setColor("#df2a3f"));
  await expect(host.locator(".semlo-editor-prose span[data-semlo-editor-gradient]")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose span").filter({ hasText: "选中文字" })).toHaveCSS(
    "color",
    "rgb(223, 42, 63)",
  );
});

test("custom color sliders update the selected text and reject incomplete values", async ({ page }) => {
  const host = await mount(page);
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  await page.getByRole("dialog", { name: "选择颜色", exact: true }).getByRole("button", { name: "更多颜色" }).click();
  const custom = page.getByRole("dialog", { name: "自定义颜色" });
  await custom.getByLabel("HEX", { exact: true }).fill("#ff0000");
  const text = host.locator(".semlo-editor-prose span").filter({ hasText: "选中文字" });
  await expect(text).toHaveCSS("color", "rgb(255, 0, 0)");
  await custom.getByLabel("HEX", { exact: true }).fill("#f");
  await expect(text).toHaveCSS("color", "rgb(255, 0, 0)");
  await custom.getByLabel("透明度").focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  await expect(text).toHaveCSS("color", "rgba(255, 0, 0, 0.95)");
  const field = custom.getByLabel("颜色饱和度与亮度");
  await field.focus();
  await page.keyboard.press("ArrowDown");
  await expect(text).not.toHaveCSS("color", "rgba(255, 0, 0, 0.95)");
});

test("the custom panel stays inside a narrow viewport and closes on read-only", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 270 });
  const host = await mount(page);
  const more = host.getByRole("button", { name: "更多", exact: true });
  await expect(more).toBeVisible();
  const panelId = await more.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  await more.click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  await expect(overflow).toBeVisible();
  await expect(overflow).toHaveAttribute("id", panelId!);
  await overflow.getByRole("button", { name: "文字颜色", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  await palette.getByRole("button", { name: "更多颜色" }).click();
  const custom = page.getByRole("dialog", { name: "自定义颜色" });
  const box = await custom.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(312);
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.y + box!.height).toBeLessThanOrEqual(262);
  const input = custom.getByLabel("HEX", { exact: true });
  await input.fill("#0a78cc");
  await expect(input).toBeFocused();
  await expect(host.locator(".semlo-editor-prose span").filter({ hasText: "选中文字" })).toHaveCSS(
    "color",
    "rgb(10, 120, 204)",
  );
  await page.evaluate(() => window.__semloRequireFixture("colorFidelityEditor").setEditable(false));
  await expect(palette).toHaveCount(0);
  await expect(custom).toHaveCount(0);
  await expect(overflow).toBeHidden();
});
