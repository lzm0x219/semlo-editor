import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    textStyleMenuEditors?: EditorController[];
  }
}

async function mount(page: Page, count = 1) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      window.textStyleMenuEditors = []
      for (let index = 0; index < ${count}; index++) {
        const host = document.createElement('div')
        host.id = 'text-style-menu-' + index
        document.body.prepend(host)
        window.textStyleMenuEditors.push(createEditor({ element: host, outline: false, content: '<p>甲乙丙</p>' }))
      }
    `,
  });
  await page.waitForFunction((number) => window.textStyleMenuEditors?.length === number, count);
  return page.locator("#text-style-menu-0");
}

async function selectText(page: Page, host: ReturnType<Page["locator"]>) {
  await host.locator(".semlo-editor-prose p").click();
  await page.evaluate(() =>
    window.__semloRequireFixture("textStyleMenuEditors")[0].editor.commands.setTextSelection({ from: 2, to: 4 }),
  );
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("text style menu applies inline code and exposes the active state", async ({ page }) => {
  const host = await mount(page);
  const trigger = host.getByRole("button", { name: "上下标" });
  await selectText(page, host);
  await trigger.click();
  const menu = page.getByRole("menu", { name: "更多文本样式" });
  await expect(menu.getByRole("menuitem")).toHaveText(["上标", "下标", "行内代码"]);
  await expect(menu).toHaveCSS("border-radius", "8px");
  expect((await menu.boundingBox())?.width).toBe(126);
  const code = menu.getByRole("menuitem", { name: "行内代码" });
  expect((await code.boundingBox())?.height).toBe(32);
  await code.click();
  await expect(host.locator(".semlo-editor-prose code")).toHaveText("乙丙");
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  await trigger.click();
  const active = menu.getByRole("menuitem", { name: "行内代码" });
  await expect(active).toHaveAttribute("aria-current", "true");
  await expect(active).toHaveAttribute("aria-description", "已启用");
  await active.click();
  await expect(host.locator(".semlo-editor-prose code")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("textStyleMenuEditors")[0].editor.commands.undo()),
  ).toBe(true);
  await expect(host.locator(".semlo-editor-prose code")).toHaveText("乙丙");
});

test("keyboard menu navigation, script exclusivity and inline-code shortcut preserve the selection", async ({
  page,
}) => {
  const host = await mount(page);
  const trigger = host.getByRole("button", { name: "上下标" });
  await selectText(page, host);
  await trigger.click();
  const menu = page.getByRole("menu", { name: "更多文本样式" });
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "上标" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "下标" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(host.locator(".semlo-editor-prose sub")).toHaveText("乙丙");
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  await trigger.click();
  await expect(menu.getByRole("menuitem", { name: "下标" })).toHaveAttribute("aria-current", "true");
  await menu.getByRole("menuitem", { name: "上标" }).click();
  await expect(host.locator(".semlo-editor-prose sup")).toHaveText("乙丙");
  await expect(host.locator(".semlo-editor-prose sub")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+e");
  await expect(host.locator(".semlo-editor-prose code")).toHaveText("乙丙");
  await expect(host.locator(".semlo-editor-prose code sup")).toHaveText("乙丙");
});

const compatibleStyles = [
  ["bold", "加粗"],
  ["italic", "斜体"],
  ["underline", "下划线"],
  ["strike", "删除线"],
  ["subscript", "下标"],
  ["superscript", "上标"],
  ["highlight", "高亮颜色"],
  ["link", "链接"],
] as const;

for (const [mark, label] of compatibleStyles) {
  for (const order of ["style-first", "code-first"] as const) {
    test(`inline code and ${mark} retain both marks in ${order} order and survive HTML and JSON`, async ({ page }) => {
      const host = await mount(page);
      const trigger = host.getByRole("button", { name: "上下标" });
      const menu = page.getByRole("menu", { name: "更多文本样式" });
      const applyCode = async () => {
        await trigger.click();
        await menu.getByRole("menuitem", { name: "行内代码" }).click();
        await expect(host.locator(".semlo-editor-prose")).toBeFocused();
      };
      const applyStyle = async () => {
        if (mark === "subscript" || mark === "superscript") {
          await trigger.click();
          await menu.getByRole("menuitem", { name: label }).click();
        } else if (mark === "highlight") {
          await host.getByRole("button", { name: "高亮颜色", exact: true }).click();
          await page.getByRole("dialog", { name: "选择颜色" }).getByRole("button", { name: "浅蓝 1 #d9eafc" }).click();
        } else if (mark === "link") {
          await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "链接" }).click();
          const form = page.getByRole("dialog", { name: "插入链接" });
          await expect(form.getByLabel("文本")).toHaveValue("乙丙");
          await form.getByLabel("链接", { exact: true }).fill("https://example.com/reference");
          await form.getByRole("button", { name: "确定" }).click();
        } else {
          await host
            .getByRole("toolbar", { name: "文本格式" })
            .getByRole("button", { name: label, exact: true })
            .click();
        }
        await expect(host.locator(".semlo-editor-prose")).toBeFocused();
      };
      const selectedMarks = () =>
        page.evaluate(() => {
          const paragraph = window.__semloRequireFixture("textStyleMenuEditors")[0].getSnapshot().json.content?.[0];
          return paragraph?.content
            ?.find((node) => node.text === "乙丙")
            ?.marks?.map((value) => value.type)
            .sort();
        });

      await selectText(page, host);
      if (order === "style-first") {
        await applyStyle();
        await applyCode();
      } else {
        await applyCode();
        await applyStyle();
      }
      expect(await selectedMarks()).toEqual([mark, "code"].sort());
      if (mark === "highlight")
        await expect(host.locator(".semlo-editor-prose code mark")).toHaveCSS("background-color", "rgb(217, 234, 252)");
      if (mark === "link")
        await expect(host.locator(".semlo-editor-prose code a")).toHaveAttribute(
          "href",
          "https://example.com/reference",
        );
      const snapshot = await page.evaluate(() => window.__semloRequireFixture("textStyleMenuEditors")[0].getSnapshot());
      expect(snapshot.html).toContain("<code>");
      for (const content of [snapshot.html, snapshot.json]) {
        await page.evaluate(
          (value) => window.__semloRequireFixture("textStyleMenuEditors")[0].setContent(value),
          content,
        );
        expect(await selectedMarks()).toEqual([mark, "code"].sort());
        if (mark === "highlight")
          await expect(host.locator(".semlo-editor-prose code mark")).toHaveCSS(
            "background-color",
            "rgb(217, 234, 252)",
          );
        if (mark === "link")
          await expect(host.locator(".semlo-editor-prose code a")).toHaveAttribute(
            "href",
            "https://example.com/reference",
          );
      }
    });
  }
}

test("toggling bold on inline code keeps the code mark and undo restores each change", async ({ page }) => {
  const host = await mount(page);
  await selectText(page, host);
  await host.getByRole("button", { name: "上下标" }).click();
  await page.getByRole("menuitem", { name: "行内代码" }).click();
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "加粗", exact: true }).click();
  await expect(host.locator(".semlo-editor-prose code strong")).toHaveText("乙丙");
  await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "加粗", exact: true }).click();
  await expect(host.locator(".semlo-editor-prose code")).toHaveText("乙丙");
  await expect(host.locator(".semlo-editor-prose strong")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("textStyleMenuEditors")[0].editor.commands.undo()),
  ).toBe(true);
  await expect(host.locator(".semlo-editor-prose code strong")).toHaveText("乙丙");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("textStyleMenuEditors")[0].editor.commands.redo()),
  ).toBe(true);
  await expect(host.locator(".semlo-editor-prose code")).toHaveText("乙丙");
  await expect(host.locator(".semlo-editor-prose strong")).toHaveCount(0);
});

test("toggling inline code preserves an existing link and background color", async ({ page }) => {
  const host = await mount(page);
  const trigger = host.getByRole("button", { name: "上下标" });
  const menu = page.getByRole("menu", { name: "更多文本样式" });
  await selectText(page, host);
  await host.getByRole("button", { name: "高亮颜色", exact: true }).click();
  await page.getByRole("dialog", { name: "选择颜色" }).getByRole("button", { name: "浅蓝 1 #d9eafc" }).click();
  await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "链接" }).click();
  const form = page.getByRole("dialog", { name: "插入链接" });
  await form.getByLabel("链接", { exact: true }).fill("https://example.com/reference");
  await form.getByRole("button", { name: "确定" }).click();
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  const chooseCode = async () => {
    await trigger.click();
    await menu.getByRole("menuitem", { name: "行内代码" }).click();
    await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  };
  await chooseCode();
  await expect(host.locator(".semlo-editor-prose code a")).toHaveAttribute("href", "https://example.com/reference");
  await expect(host.locator(".semlo-editor-prose code mark")).toHaveCSS("background-color", "rgb(217, 234, 252)");
  await chooseCode();
  await expect(host.locator(".semlo-editor-prose code")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose a")).toHaveAttribute("href", "https://example.com/reference");
  await expect(host.locator(".semlo-editor-prose mark")).toHaveCSS("background-color", "rgb(217, 234, 252)");
  await chooseCode();
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("textStyleMenuEditors")[0].getSnapshot());
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("textStyleMenuEditors")[0].setContent(value), content);
    await expect(host.locator(".semlo-editor-prose code a")).toHaveAttribute("href", "https://example.com/reference");
    await expect(host.locator(".semlo-editor-prose code mark")).toHaveCSS("background-color", "rgb(217, 234, 252)");
  }
});

test("switching a styled inline-code selection from subscript to superscript keeps its other styles", async ({
  page,
}) => {
  const host = await mount(page);
  const trigger = host.getByRole("button", { name: "上下标" });
  const menu = page.getByRole("menu", { name: "更多文本样式" });
  const choose = async (label: string) => {
    await trigger.click();
    await menu.getByRole("menuitem", { name: label }).click();
    await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  };
  await selectText(page, host);
  await choose("下标");
  await choose("行内代码");
  for (const label of ["加粗", "斜体", "下划线", "删除线"]) {
    await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: label, exact: true }).click();
    await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  }
  await choose("上标");
  const getMarks = () =>
    page.evaluate(() => {
      const paragraph = window.__semloRequireFixture("textStyleMenuEditors")[0].getSnapshot().json.content?.[0];
      return paragraph?.content
        ?.find((node) => node.text === "乙丙")
        ?.marks?.map((mark) => mark.type)
        .sort();
    });
  expect(await getMarks()).toEqual(["bold", "code", "italic", "strike", "superscript", "underline"]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("textStyleMenuEditors")[0].editor.commands.undo()),
  ).toBe(true);
  expect(await getMarks()).toEqual(["bold", "code", "italic", "strike", "subscript", "underline"]);
});

test("read-only, destruction and independent editor menus leave no stale popup", async ({ page }) => {
  const first = await mount(page, 2);
  const second = page.locator("#text-style-menu-1");
  const firstTrigger = first.getByRole("button", { name: "上下标" });
  const secondTrigger = second.getByRole("button", { name: "上下标" });
  await firstTrigger.click();
  expect(await page.getByRole("menu", { name: "更多文本样式" }).count(), "first editor opened its menu").toBe(1);
  const firstPopup = await firstTrigger.getAttribute("aria-controls");
  await secondTrigger.click();
  expect(await page.getByRole("menu", { name: "更多文本样式" }).count(), "second editor owns the only menu").toBe(1);
  expect(await secondTrigger.getAttribute("aria-controls")).not.toBe(firstPopup);
  await page.evaluate(() => window.__semloRequireFixture("textStyleMenuEditors")[1].setEditable(false));
  expect(await second.locator(".semlo-editor-script").isDisabled(), "read-only trigger is disabled").toBe(true);
  expect(await page.getByRole("menu", { name: "更多文本样式" }).count(), "read-only closes the menu").toBe(0);
  await firstTrigger.click();
  await page.keyboard.press("Escape");
  expect(
    await firstTrigger.evaluate((element) => element === document.activeElement),
    "Escape returns focus to the trigger",
  ).toBe(true);
  await firstTrigger.click();
  await page.evaluate(() => window.__semloRequireFixture("textStyleMenuEditors")[0].destroy());
  expect(await page.getByRole("menu", { name: "更多文本样式" }).count(), "destroy closes the menu").toBe(0);
});

test("keyboard menu navigation skips disabled items and handles an entirely disabled menu", async ({ page }) => {
  const host = await mount(page);
  const trigger = host.getByRole("button", { name: "上下标" });
  await host.locator(".semlo-editor-prose p").click();
  await trigger.click();
  const menu = page.getByRole("menu", { name: "更多文本样式" });
  const sup = menu.getByRole("menuitem", { name: "上标" });
  const sub = menu.getByRole("menuitem", { name: "下标" });
  const code = menu.getByRole("menuitem", { name: "行内代码" });
  // Model the case where the current selection cannot accept only this mark.
  await sup.evaluate((element) => ((element as HTMLButtonElement).disabled = true));
  await page.keyboard.press("ArrowDown");
  await expect(sub).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(code).toBeFocused();
  await sub.evaluate((element) => ((element as HTMLButtonElement).disabled = true));
  await code.evaluate((element) => ((element as HTMLButtonElement).disabled = true));
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
