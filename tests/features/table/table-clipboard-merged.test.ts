import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    tableClipboardEditor?: EditorController;
  }
}

test("copying a merged selection uses physical cells in text while retaining HTML spans", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'table-clipboard-test'
    document.body.prepend(host)
    window.tableClipboardEditor = createEditor({ element: host, content: '<table><tbody><tr><td rowspan="2" style="background-color:#00ffff;vertical-align:top">合并</td><td>甲</td><td>留</td></tr><tr><td>乙</td><td>余</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableClipboardEditor));
  const prose = page.locator("#table-clipboard-test .semlo-editor-prose");
  const first = await prose.locator('td[rowspan="2"]').boundingBox();
  const last = await prose.getByRole("cell", { name: "乙", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + 10);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(3);
  expect(
    await page.evaluate(() => {
      const { state, view } = window.__semloRequireFixture("tableClipboardEditor").editor;
      const end = state.doc.content.size;
      const tablePlugin = state.plugins.find((plugin) =>
        /^semloEditorTableClipboard\$(?:\d+)?$/.test((plugin as unknown as { key: string }).key),
      )!;
      return tablePlugin.props.clipboardTextSerializer!.call(tablePlugin, state.doc.slice(end - 3, end - 1), view);
    }),
  ).toBe("");
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("合并\t甲\n乙");
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((value) => value.types.includes("text/html"))!;
    return (await item.getType("text/html")).text();
  });
  expect(html).toContain('rowspan="2"');
  expect(html).toContain("background-color");
  await prose.getByRole("cell", { name: "甲", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "复制", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("合并\t甲\n乙");
  const original = await page.evaluate(() => window.__semloRequireFixture("tableClipboardEditor").getSnapshot());
  await page.keyboard.press("ControlOrMeta+x");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("合并\t甲\n乙");
  await expect(prose.locator("td[rowspan='2']")).toHaveText("");
  await expect(prose.locator("td[rowspan='2']")).toHaveCSS("background-color", "rgb(0, 255, 255)");
  await expect(prose.locator("td[rowspan='2']")).toHaveCSS("vertical-align", "top");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["", "", "留"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableClipboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableClipboardEditor").getSnapshot())).json).toEqual(
    original.json,
  );
  await page.evaluate(() =>
    window
      .__semloRequireFixture("tableClipboardEditor")
      .setContent(
        '<table><tbody><tr><td colspan="2"><p>上</p><p>下</p></td><td>留</td></tr><tr><td>左</td><td>右</td><td>余</td></tr></tbody></table><p>后文</p>',
      ),
  );
  const horizontal = await prose.locator('td[colspan="2"]').boundingBox();
  const lower = await prose.getByRole("cell", { name: "左", exact: true }).boundingBox();
  if (!horizontal || !lower) throw new Error("Missing table cells");
  await page.mouse.move(horizontal.x + horizontal.width - 15, horizontal.y + horizontal.height / 2);
  await page.mouse.down();
  await page.mouse.move(lower.x + lower.width - 15, lower.y + lower.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("上\n下\n左\t右");
});

test("copying Semlo table content preserves custom font sizes on paste", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'table-clipboard-test'
    document.body.prepend(host)
    window.tableClipboardEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p><span style="font-size:20px">来源</span></p></td><td>甲</td></tr><tr><td>目标</td><td>乙</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableClipboardEditor));
  const prose = page.locator("#table-clipboard-test .semlo-editor-prose");
  const first = await prose.getByRole("cell", { name: "来源", exact: true }).boundingBox();
  const last = await prose.getByRole("cell", { name: "甲", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+c");
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return (await items.find((item) => item.types.includes("text/html"))!.getType("text/html")).text();
  });
  expect(html).toContain("data-pm-slice");
  await prose.getByRole("cell", { name: "目标", exact: true }).click();
  await page.evaluate(
    (value) =>
      navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([value], { type: "text/html" }),
          "text/plain": new Blob(["来源\t甲"], { type: "text/plain" }),
        }),
      ]),
    html,
  );
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = prose.locator("tr").nth(1).locator("td").first();
  await expect(pasted).toHaveText("来源");
  await expect(pasted.getByText("来源")).toHaveCSS("font-size", "20px");
});
