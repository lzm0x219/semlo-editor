import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    tablePasteEditor?: EditorController;
  }
}

test("plain tab-separated text pastes as paragraphs in the active cell", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-paste-test'
      document.body.prepend(host)
      window.tablePasteEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>留</p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tablePasteEditor));
  const prose = page.locator("#table-paste-test .semlo-editor-prose");
  const cell = prose.locator("tr").first().locator("td").first();
  await cell.click();
  await page.keyboard.press("End");
  const before = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  await page.evaluate(() => navigator.clipboard.writeText("甲\t乙\n丙\t丁"));
  await page.keyboard.press("Meta+v");
  await expect(cell.locator("p")).toHaveText(["留甲\t乙", "丙\t丁"]);
  await expect(prose.locator("tr").first().locator("td").nth(1)).toHaveText("");
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("pasting an HTML table fills cells and adds rows when necessary", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-paste-test'
      document.body.prepend(host)
      window.tablePasteEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tablePasteEditor));
  const prose = page.locator("#table-paste-test .semlo-editor-prose");
  await prose.locator("tr").nth(1).locator("td").first().click();
  const before = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(
          [
            "<table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td></tr><tr><td><p>丙</p></td><td><p>丁</p></td></tr></tbody></table>",
          ],
          { type: "text/html" },
        ),
        "text/plain": new Blob(["甲\t乙\n丙\t丁"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr")).toHaveCount(3);
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["A", "B"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["甲", "乙"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["丙", "丁"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await prose.locator("tr").nth(1).locator("td").first().click();
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(
          [
            '<ne-clipboard data="%7B%7D"></ne-clipboard><div class="lake-content"><table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td></tr><tr><td><p>丙</p></td><td><p>丁</p></td></tr></tbody></table></div>',
          ],
          { type: "text/html" },
        ),
        "text/plain": new Blob(["甲\t乙\n丙\t丁"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["甲", "乙"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["丙", "丁"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("HTML table paste follows physical cells and preserves destination merges", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-paste-test'
      document.body.prepend(host)
      window.tablePasteEditor = createEditor({ element: host, content: '<table><tbody><tr><td colspan="2"><p>回</p></td><td><p>跳</p></td></tr><tr><td><p></p></td><td colspan="2"><p></p></td></tr><tr><td><p>留</p></td><td><p></p></td><td><p></p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tablePasteEditor));
  const prose = page.locator("#table-paste-test .semlo-editor-prose");
  await prose.locator("td[colspan='2']").first().click();
  const before = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(
          [
            "<table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td></tr><tr><td><p>丙</p></td><td><p>丁</p></td></tr></tbody></table>",
          ],
          { type: "text/html" },
        ),
        "text/plain": new Blob(["甲\t乙\n丙\t丁"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["甲", "乙"]);
  await expect(prose.locator("tr").nth(0).locator("td").first()).toHaveAttribute("colspan", "2");
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["丙", "丁"]);
  await expect(prose.locator("tr").nth(1).locator("td").nth(1)).toHaveAttribute("colspan", "2");
  await expect(prose.locator("tr").nth(2).locator("td").first()).toHaveText("留");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("甲");
  const after = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.redo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    after.json,
  );
  for (const content of [after.html, after.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), content);
    expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
      after.json,
    );
  }
});

test("HTML table paste preserves a vertical merge and does not overwrite it twice", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-paste-test'
      document.body.prepend(host)
      window.tablePasteEditor = createEditor({ element: host, content: '<table><tbody><tr><td rowspan="2"><p>旧</p></td><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr><tr><td><p>留</p></td><td><p>E</p></td><td><p>F</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tablePasteEditor));
  const prose = page.locator("#table-paste-test .semlo-editor-prose");
  await prose.locator("td[rowspan='2']").click();
  const before = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(
          [
            "<table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td></tr><tr><td><p>丙</p></td><td><p>丁</p></td></tr></tbody></table>",
          ],
          { type: "text/html" },
        ),
        "text/plain": new Blob(["甲\t乙\n丙\t丁"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["甲", "乙", "B"]);
  await expect(prose.locator("td[rowspan='2']")).toHaveText("甲");
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["丁", "D"]);
  await expect(prose.locator("tr").nth(2).locator("td").first()).toHaveText("留");
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await prose.locator("td[rowspan='2']").click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tablePasteEditor").editor;
    const text = document.querySelector("#table-paste-test td[rowspan='2'] p")!.firstChild!;
    editor.commands.setTextSelection(editor.view.posAtDOM(text, 0));
  });
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(
          [
            "<table><tbody><tr><td>一</td><td>A</td></tr><tr><td>二</td><td>B</td></tr><tr><td>三</td><td>C</td></tr><tr><td>四</td><td>D</td></tr></tbody></table>",
          ],
          { type: "text/html" },
        ),
        "text/plain": new Blob(["一\tA\n二\tB\n三\tC\n四\tD"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr")).toHaveCount(4);
  await expect(prose.locator("td[rowspan='2']")).toHaveText("一");
  await expect(prose.locator("tr").nth(1).locator("td").first()).toHaveText("B");
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["三", "C", "F"]);
  await expect(prose.locator("tr").nth(3).locator("td")).toHaveText(["四", "D", ""]);
  const expanded = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.redo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    expanded.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await prose.locator("td[rowspan='2']").click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tablePasteEditor").editor;
    const text = document.querySelector("#table-paste-test td[rowspan='2'] p")!.firstChild!;
    editor.commands.setTextSelection(editor.view.posAtDOM(text, 0));
  });
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(
          [
            "<table><tbody><tr><td>甲</td><td>乙</td><td>丙</td><td>丁</td></tr><tr><td>戊</td><td>己</td><td>庚</td><td>辛</td></tr></tbody></table>",
          ],
          { type: "text/html" },
        ),
        "text/plain": new Blob(["甲\t乙\t丙\t丁\n戊\t己\t庚\t辛"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["甲", "乙", "丙", "丁"]);
  await expect(prose.locator("td[rowspan='2']")).toHaveText("甲");
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["己", "庚", "辛"]);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["留", "E", "F", ""]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("merged source cells do not replace destination structure or covered values", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-paste-test'
      document.body.prepend(host)
      window.tablePasteEditor = createEditor({ element: host, content: '<table><tbody><tr><td rowspan="2"><p>旧</p></td><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr><tr><td><p>留</p></td><td><p>E</p></td><td><p>F</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tablePasteEditor));
  const prose = page.locator("#table-paste-test .semlo-editor-prose");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  const original = await snapshot();
  const paste = async (html: string) => {
    await page.evaluate(
      (value) =>
        navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([value], { type: "text/html" }),
            "text/plain": new Blob(["测试"], { type: "text/plain" }),
          }),
        ]),
      html,
    );
    await page.keyboard.press("Meta+v");
  };
  const horizontal =
    '<table><tbody><tr><td colspan="2"><p>首横</p></td></tr><tr><td><p>甲横</p></td><td><p>乙横</p></td></tr></tbody></table>';
  await prose.locator("td[rowspan='2']").click();
  await paste(horizontal);
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["首横", "A", "B"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["乙横", "D"]);
  await expect(prose.locator("td[rowspan='2']")).toHaveText("首横");
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await snapshot()).json).toEqual(original.json);
  await prose.getByRole("cell", { name: "留", exact: true }).click();
  await paste(horizontal);
  await expect(prose.locator("tr").nth(2).locator("td")).toHaveText(["首横", "E", "F"]);
  await expect(prose.locator("tr").nth(3).locator("td")).toHaveText(["甲横", "乙横", ""]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await snapshot()).json).toEqual(original.json);
  await prose.locator("td[rowspan='2']").click();
  const editor = await page.evaluate(() => {
    const api = window.__semloRequireFixture("tablePasteEditor").editor;
    const text = document.querySelector("#table-paste-test td[rowspan='2'] p")!.firstChild!;
    api.commands.setTextSelection(api.view.posAtDOM(text, 0));
    return true;
  });
  expect(editor).toBe(true);
  await paste(
    '<table><tbody><tr><td rowspan="2"><p>首竖</p></td><td><p>甲竖</p></td></tr><tr><td><p>乙竖</p></td></tr></tbody></table>',
  );
  await expect(prose.locator("td[rowspan='2']")).toHaveText("首竖");
  await expect(prose.locator("tr").nth(0).locator("td").nth(1)).toHaveText("甲竖");
  await expect(prose.locator("tr").nth(1).locator("td").first()).toHaveText("乙竖");
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await snapshot()).json).toEqual(original.json);
});

test("pasting a single HTML cell repeats it over a selected rectangle", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-paste-test'
      document.body.prepend(host)
      window.tablePasteEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tablePasteEditor));
  const prose = page.locator("#table-paste-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  const first = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  const last = await prose.getByRole("cell", { name: "D", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(4);
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<table><tbody><tr><td><p>填</p></td></tr></tbody></table>"], { type: "text/html" }),
        "text/plain": new Blob(["填"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["填", "填"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["填", "填"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.evaluate(() => navigator.clipboard.writeText("甲\t乙\n丙\t丁"));
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["甲\t乙", "甲\t乙"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["丙\t丁", "丙\t丁"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<p><strong>粗体</strong></p><p><em>第二</em></p>"], { type: "text/html" }),
        "text/plain": new Blob(["粗体\n第二"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(0).locator("td strong")).toHaveText(["粗体", "粗体"]);
  await expect(prose.locator("tr").nth(1).locator("td em")).toHaveText(["第二", "第二"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<table><tbody><tr><td colspan='2'>并</td></tr></tbody></table>"], {
          type: "text/html",
        }),
        "text/plain": new Blob(["并"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["并", "并"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["并", "并"]);
  await expect(prose.locator("td[colspan='2']")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("pasting into a rectangle containing a vertical merge preserves the merge", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-paste-test'
      document.body.prepend(host)
      window.tablePasteEditor = createEditor({ element: host, content: '<table><tbody><tr><td rowspan="2"><p>旧</p></td><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tablePasteEditor));
  const prose = page.locator("#table-paste-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  const first = await prose.locator("td[rowspan='2']").boundingBox();
  const last = await prose.getByRole("cell", { name: "C", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + 10);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(3);
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<table><tbody><tr><td><p>填</p></td></tr></tbody></table>"], { type: "text/html" }),
        "text/plain": new Blob(["填"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("td[rowspan='2']")).toHaveText("填");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["填", "填", "B"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["填", "D"]);
  await expect(prose.locator(".selectedCell")).toHaveCount(3);
  const after = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.redo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    after.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td></tr></tbody></table>"], {
          type: "text/html",
        }),
        "text/plain": new Blob(["甲\t乙"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("td[rowspan='2']")).toHaveText("甲");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["甲", "乙", "B"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["甲", "D"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(
          ["<table><tbody><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></tbody></table>"],
          { type: "text/html" },
        ),
        "text/plain": new Blob(["甲\t乙\n丙\t丁"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("td[rowspan='2']")).toHaveCount(0);
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["甲", "乙", "B"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["丙", "丁", "D"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<table><tbody><tr><td colspan='2'><p>并</p></td></tr></tbody></table>"], {
          type: "text/html",
        }),
        "text/plain": new Blob(["并"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("td[rowspan='2']")).toHaveText("并");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["并", "并", "B"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["并", "D"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  await page.evaluate(() => navigator.clipboard.writeText("甲\t乙\n丙\t丁"));
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("td[rowspan='2']")).toHaveText("甲\t乙");
  await expect(prose.locator("tr").nth(0).locator("td")).toHaveText(["甲\t乙", "甲\t乙", "B"]);
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["丙\t丁", "D"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("pasting lists and quotes into a selected rectangle follows their observed cell mapping", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-paste-test'
      document.body.prepend(host)
      window.tablePasteEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tablePasteEditor));
  const prose = page.locator("#table-paste-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  const first = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  const last = await prose.getByRole("cell", { name: "D", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(4);
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<ul><li>条目一</li><li>条目二</li></ul>"], { type: "text/html" }),
        "text/plain": new Blob(["条目一\n条目二"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(0).locator("td").nth(0).locator("li")).toHaveText(["条目一", "条目二"]);
  await expect(prose.locator("tr").nth(0).locator("td").nth(1)).toHaveText("");
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["", ""]);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("条目二");
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<blockquote><p>引用甲</p><p>引用乙</p></blockquote>"], { type: "text/html" }),
        "text/plain": new Blob(["引用甲\n引用乙"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(0).locator("td").first().locator("p")).toHaveText(["引用甲", "引用乙"]);
  await expect(prose.locator("tr").nth(0).locator("td").nth(1)).toHaveText("引用甲");
  await expect(prose.locator("tr").nth(1).locator("td")).toHaveText(["引用甲", "引用甲"]);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("引用乙");
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<pre><code>alpha\nbeta</code></pre>"], { type: "text/html" }),
        "text/plain": new Blob(["alpha\nbeta"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("td pre")).toHaveCount(4);
  await expect(prose.locator("td pre")).toHaveText(["alpha\nbeta", "alpha\nbeta", "alpha\nbeta", "alpha\nbeta"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("formatted paragraph rows cycle over a taller selected rectangle", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'table-paste-test'
    document.body.prepend(host)
    window.tablePasteEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr><tr><td>E</td><td>F</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tablePasteEditor));
  const prose = page.locator("#table-paste-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  const first = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  const last = await prose.getByRole("cell", { name: "F", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(6);
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<p><strong>首</strong></p><p><em>次</em></p>"], { type: "text/html" }),
        "text/plain": new Blob(["首\n次"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(0).locator("td strong")).toHaveText(["首", "首"]);
  await expect(prose.locator("tr").nth(1).locator("td em")).toHaveText(["次", "次"]);
  await expect(prose.locator("tr").nth(2).locator("td strong")).toHaveText(["首", "首"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("table paste applies explicit cell backgrounds and otherwise keeps destination backgrounds", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'table-paste-test'
    document.body.prepend(host)
    window.tablePasteEditor = createEditor({ element: host, content: '<table><tbody><tr><td rowspan="2" style="background-color: #00ff00"><p>旧</p></td><td>留</td></tr><tr><td>余</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tablePasteEditor));
  const prose = page.locator("#table-paste-test .semlo-editor-prose");
  const merged = prose.locator('td[rowspan="2"]');
  const before = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  const paste = async (html: string) => {
    await merged.click();
    await page.evaluate(
      (value) =>
        navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([value], { type: "text/html" }),
            "text/plain": new Blob(["内容"], { type: "text/plain" }),
          }),
        ]),
      html,
    );
    await page.keyboard.press("Meta+v");
  };
  await paste(
    '<table><tbody><tr><td style="background-color:#ff0000"><p style="text-align:center"><strong>格式</strong></p></td></tr></tbody></table>',
  );
  await expect(merged).toHaveCSS("background-color", "rgb(255, 0, 0)");
  await expect(merged.locator("strong")).toHaveText("格式");
  await expect(merged.locator("p")).toHaveCSS("text-align", "center");
  const after = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  for (const content of [after.html, after.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), content);
    await expect(merged).toHaveCSS("background-color", "rgb(255, 0, 0)");
  }
  await paste("<table><tbody><tr><td><p>无底色</p></td></tr></tbody></table>");
  await expect(merged).toHaveText("无底色");
  await expect(merged).toHaveCSS("background-color", "rgb(255, 0, 0)");
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    after.json,
  );
  await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), before.json);
  await expect(merged).toHaveCSS("background-color", "rgb(0, 255, 0)");
  await paste(
    '<table><tbody><tr><td style="background-color:#00ff00">甲</td><td style="background-color:#0000ff">乙</td></tr></tbody></table>',
  );
  await expect(merged).toHaveText("甲");
  await expect(merged).toHaveCSS("background-color", "rgb(0, 255, 0)");
  await expect(prose.locator("tr").first().locator("td").nth(1)).toHaveText("乙");
  await expect(prose.locator("tr").first().locator("td").nth(1)).toHaveCSS("background-color", "rgb(0, 0, 255)");
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  await paste('<table><tbody><tr style="background-color:#ff00ff"><td>行底色</td></tr></tbody></table>');
  await expect(merged).toHaveCSS("background-color", "rgb(255, 0, 255)");
  await paste('<table style="background-color:#ffff00"><tbody><tr><td>表底色</td></tr></tbody></table>');
  await expect(merged).toHaveCSS("background-color", "rgb(255, 255, 0)");
  await paste(
    '<table style="background-color:#ffff00"><tbody><tr style="background-color:#ff00ff"><td style="background-color:#00ffff">格底色</td></tr></tbody></table>',
  );
  await expect(merged).toHaveCSS("background-color", "rgb(0, 255, 255)");
  await paste(
    '<ne-clipboard data="%7B%7D" source="https%3A%2F%2Fwww.yuque.com%2Fexample"></ne-clipboard><table><tbody style="background-color:#008000"><tr><td>组底色</td></tr></tbody></table>',
  );
  await expect(merged).toHaveCSS("background-color", "rgb(0, 255, 255)");
  await paste('<table><tbody style="background-color:#008000"><tr><td>未知组底色</td></tr></tbody></table>');
  await expect(merged).toHaveCSS("background-color", "rgb(0, 128, 0)");
  await page.evaluate(() =>
    window
      .__semloRequireFixture("tablePasteEditor")
      .setContent(
        '<table><tbody><tr><td>A</td><td style="background-color:#ff0000">B</td></tr></tbody></table><p>后文</p>',
      ),
  );
  const first = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  for (const html of [
    '<table><tbody><tr><td style="background-color:#00ff00">新底色</td></tr></tbody></table>',
    "<table><tbody><tr><td>无色</td></tr></tbody></table>",
  ]) {
    await page.evaluate(
      (value) =>
        navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([value], { type: "text/html" }),
            "text/plain": new Blob(["内容"], { type: "text/plain" }),
          }),
        ]),
      html,
    );
    await page.keyboard.press("Meta+v");
    await expect(prose.locator("td").first()).toHaveCSS("background-color", "rgb(0, 255, 0)");
    await expect(prose.locator("td").last()).toHaveCSS("background-color", "rgb(0, 255, 0)");
  }
  await expect(prose.locator("td")).toHaveText(["无色", "无色"]);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("tablePasteEditor")
      .setContent(
        '<table><tbody><tr><td style="background-color:#00ff00">A</td><td style="background-color:#00ff00">B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>',
      ),
  );
  const top = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  const bottom = await prose.getByRole("cell", { name: "D", exact: true }).boundingBox();
  if (!top || !bottom) throw new Error("Missing table cells");
  await page.mouse.move(top.x + top.width - 15, top.y + top.height / 2);
  await page.mouse.down();
  await page.mouse.move(bottom.x + bottom.width - 15, bottom.y + bottom.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(
          [
            '<table><tbody><tr><td>甲</td><td>乙</td></tr><tr><td style="background-color:#0000ff">丙</td><td>丁</td></tr></tbody></table>',
          ],
          { type: "text/html" },
        ),
        "text/plain": new Blob(["甲\t乙\n丙\t丁"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.keyboard.press("Meta+v");
  await expect(prose.locator("tr").nth(0).locator("td").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(prose.locator("tr").nth(0).locator("td").last()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(prose.locator("tr").nth(1).locator("td").first()).toHaveCSS("background-color", "rgb(0, 0, 255)");
  await expect(prose.locator("tr").nth(1).locator("td").last()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("table paste maps horizontal alignment into paragraphs and preserves vertical alignment", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'table-paste-test'
    document.body.prepend(host)
    window.tablePasteEditor = createEditor({ element: host, content: '<table><tbody><tr><td rowspan="2"><p>旧</p></td><td>留</td></tr><tr><td>余</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tablePasteEditor));
  const prose = page.locator("#table-paste-test .semlo-editor-prose");
  const merged = prose.locator('td[rowspan="2"]');
  const before = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  const paste = async (html: string) => {
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("tablePasteEditor").editor;
      const paragraph = document.querySelector("#table-paste-test td[rowspan='2'] p")!;
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, 0));
      editor.commands.focus();
    });
    await page.evaluate((value) => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/html", value);
      clipboard.setData("text/plain", "对齐");
      window
        .__semloRequireFixture("tablePasteEditor")
        .editor.view.dom.dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }),
        );
    }, html);
  };
  const yuque = (table: string) =>
    `<ne-clipboard data="%7B%7D" source="https%3A%2F%2Fwww.yuque.com%2Fexample"></ne-clipboard>${table}`;
  await paste(
    '<table><tbody><tr><td style="text-align:center;vertical-align:middle"><p>对齐</p></td></tr></tbody></table>',
  );
  await expect(merged).toHaveCSS("vertical-align", "middle");
  await expect(merged.locator("p")).toHaveCSS("text-align", "center");
  const aligned = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.undo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").editor.commands.redo())).toBe(true);
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).json).toEqual(
    aligned.json,
  );
  for (const content of [aligned.html, aligned.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), content);
    await expect(merged).toHaveCSS("vertical-align", "middle");
    await expect(merged.locator("p")).toHaveCSS("text-align", "center");
  }
  await paste("<table><tbody><tr><td><p>无对齐</p></td></tr></tbody></table>");
  await expect(merged).toHaveCSS("vertical-align", "middle");
  await expect(merged.locator("p")).not.toHaveCSS("text-align", "center");
  await paste(
    '<table><tbody><tr style="text-align:center"><td style="vertical-align:bottom"><p style="text-align:right">覆盖</p></td></tr></tbody></table>',
  );
  await expect(merged).toHaveCSS("vertical-align", "bottom");
  await expect(merged.locator("p")).toHaveCSS("text-align", "right");
  await paste(
    '<table><tbody><tr style="text-align:center;vertical-align:middle"><td><p>行对齐</p></td></tr></tbody></table>',
  );
  await expect(merged).toHaveCSS("vertical-align", "bottom");
  await expect(merged.locator("p")).toHaveCSS("text-align", "center");
  await paste(
    yuque('<table style="text-align:center"><tbody style="text-align:center"><tr><td>不继承</td></tr></tbody></table>'),
  );
  await expect(merged.locator("p")).not.toHaveCSS("text-align", "center");
  await paste('<table style="text-align:center"><tbody><tr><td>未知表对齐</td></tr></tbody></table>');
  await expect(merged.locator("p")).toHaveCSS("text-align", "center");
  await paste(yuque('<table><tbody><tr><td style="line-height:1.7"><p>非档位行高</p></td></tr></tbody></table>'));
  await expect(merged.locator("p")).toHaveAttribute("data-semlo-editor-line-height", "1.5");
  await paste(
    yuque('<table style="line-height:2"><tbody style="line-height:3"><tr><td>表行高</td></tr></tbody></table>'),
  );
  await expect(merged.locator("p")).toHaveAttribute("data-semlo-editor-line-height", "2");
  await paste(
    yuque('<table><tbody><tr><td style="line-height:2"><p style="line-height:3">段行高</p></td></tr></tbody></table>'),
  );
  await expect(merged.locator("p")).toHaveAttribute("data-semlo-editor-line-height", "3");
  await paste('<table><tbody><tr><td style="line-height:1.7"><p>未知行高</p></td></tr></tbody></table>');
  await expect(merged).toHaveAttribute("data-semlo-editor-cell-line-height", "1.7");
  const lineMetrics = await merged.locator("p").evaluate((paragraph) => {
    const style = getComputedStyle(paragraph);
    return { lineHeight: parseFloat(style.lineHeight), fontSize: parseFloat(style.fontSize) };
  });
  expect(lineMetrics.lineHeight / lineMetrics.fontSize).toBeCloseTo(1.7, 1);
  const unknownLineHeight = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  for (const content of [unknownLineHeight.html, unknownLineHeight.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), content);
    await expect(merged).toHaveAttribute("data-semlo-editor-cell-line-height", "1.7");
  }
  await paste('<table><tbody><tr><td style="color:#ff0000">文字颜色</td></tr></tbody></table>');
  await expect(merged.getByText("文字颜色")).toHaveCSS("color", "rgb(255, 0, 0)");
  await paste('<table><tbody><tr style="color:#ff0000"><td>行文字色</td></tr></tbody></table>');
  await expect(merged.getByText("行文字色")).toHaveCSS("color", "rgb(255, 0, 0)");
  await paste('<table style="color:#ff0000"><tbody><tr><td>表文字色</td></tr></tbody></table>');
  await expect(merged.getByText("表文字色")).toHaveCSS("color", "rgb(255, 0, 0)");
  await paste(yuque('<table><tbody style="color:#ff0000"><tr><td>组文字色</td></tr></tbody></table>'));
  await expect(merged.getByText("组文字色")).not.toHaveCSS("color", "rgb(255, 0, 0)");
  await paste('<table><tbody style="color:#ff0000"><tr><td>未知组文字色</td></tr></tbody></table>');
  await expect(merged.getByText("未知组文字色")).toHaveCSS("color", "rgb(255, 0, 0)");
  await paste(
    '<table><tbody><tr><td style="color:#ff0000"><p><span style="color:#0000ff">蓝</span><strong>红</strong></p></td></tr></tbody></table>',
  );
  await expect(merged.getByText("蓝", { exact: true })).toHaveCSS("color", "rgb(0, 0, 255)");
  await expect(merged.getByText("红", { exact: true })).toHaveCSS("color", "rgb(255, 0, 0)");
  await expect(merged.locator("strong")).toHaveText("红");
  await paste(
    '<table><tbody><tr><td style="color:#ff0000"><p style="color:#0000ff">段落颜色</p></td></tr></tbody></table>',
  );
  await expect(merged.getByText("段落颜色")).toHaveCSS("color", "rgb(0, 0, 255)");
  const colored = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  for (const content of [colored.html, colored.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), content);
    await expect(merged.getByText("段落颜色")).toHaveCSS("color", "rgb(0, 0, 255)");
  }
  await paste(
    yuque(
      '<table><tbody><tr><td style="font-weight:bold;font-style:italic;font-size:20px">字体样式</td></tr></tbody></table>',
    ),
  );
  await expect(merged.getByText("字体样式")).toHaveCSS("font-size", "19px");
  await expect(merged.locator("strong em")).toHaveText("字体样式");
  await paste(
    yuque(
      '<table><tbody><tr><td style="color:#ff0000;font-weight:bold;font-size:20px">组合样式</td></tr></tbody></table>',
    ),
  );
  await expect(merged.getByText("组合样式")).toHaveCSS("color", "rgb(255, 0, 0)");
  await expect(merged.getByText("组合样式")).toHaveCSS("font-size", "19px");
  await expect(merged.locator("strong")).toHaveText("组合样式");
  await paste(yuque('<table><tbody><tr><td style="font-size:20pt">字号</td></tr></tbody></table>'));
  await expect(merged.getByText("字号")).toHaveCSS("font-size", "29px");
  await paste(
    yuque(
      '<table><tbody><tr><td style="font-size:20px"><p style="font-size:150%">相对覆盖</p></td></tr></tbody></table>',
    ),
  );
  await expect(merged.getByText("相对覆盖")).toHaveCSS("font-size", "19px");
  await paste(
    yuque(
      '<table><tbody><tr><td style="font-size:20px"><p style="font-size:12px">绝对覆盖</p></td></tr></tbody></table>',
    ),
  );
  await expect(merged.getByText("绝对覆盖")).toHaveCSS("font-size", "12px");
  await paste('<table><tbody><tr><td style="font-size:20px">未知字号</td></tr></tbody></table>');
  await expect(merged.getByText("未知字号")).toHaveCSS("font-size", "20px");
  await paste(
    '<table><tbody><tr><td style="font-size:20px"><p style="font-size:150%">未知嵌套字号</p></td></tr></tbody></table>',
  );
  await expect(merged.getByText("未知嵌套字号")).toHaveCSS("font-size", "30px");
  const nestedSize = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  expect(nestedSize.html).toContain("font-size: 20px");
  expect(nestedSize.html).toContain("font-size: 150%");
  for (const content of [nestedSize.html, nestedSize.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), content);
    await expect(merged.getByText("未知嵌套字号")).toHaveCSS("font-size", "30px");
  }
  await paste(
    '<table style="font-size:20px"><tbody><tr style="font-size:150%"><td style="font-size:150%"><p style="font-size:150%">多层字号</p></td></tr></tbody></table>',
  );
  await expect(merged.getByText("多层字号")).toHaveCSS("font-size", "67.5px");
  const multiSize = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  expect(multiSize.html).toContain("data-semlo-editor-cell-font-size-chain");
  for (const content of [multiSize.html, multiSize.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), content);
    await expect(merged.getByText("多层字号")).toHaveCSS("font-size", "67.5px");
  }
  await paste('<table style="font-size:200%"><tbody><tr style="font-size:150%"><td>相对链</td></tr></tbody></table>');
  const relative = await page.evaluate(() => {
    const text = document.querySelector("#table-paste-test td[rowspan='2'] p")!;
    const editor = document.querySelector("#table-paste-test .semlo-editor-prose")!;
    return { text: parseFloat(getComputedStyle(text).fontSize), base: parseFloat(getComputedStyle(editor).fontSize) };
  });
  expect(relative.text).toBeCloseTo(relative.base * 3);
  await paste('<table><tbody><tr><td style="font-size:smaller">相对关键词</td></tr></tbody></table>');
  const keyword = await page.evaluate(() => {
    const cell = document.querySelector("#table-paste-test td[rowspan='2']")!;
    const text = cell.querySelector("p")!;
    return { cell: getComputedStyle(cell).fontSize, text: getComputedStyle(text).fontSize };
  });
  expect(keyword.text).toBe(keyword.cell);
  await paste(
    '<table><tbody><tr><td style="font-size:calc(10px + 10px)"><p style="font-size:150%">计算字号</p></td></tr></tbody></table>',
  );
  await expect(merged.getByText("计算字号")).toHaveCSS("font-size", "30px");
  const calcSize = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  expect(calcSize.html).toContain("calc(");
  for (const content of [calcSize.html, calcSize.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), content);
    await expect(merged.getByText("计算字号")).toHaveCSS("font-size", "30px");
  }
  await paste(
    '<table><tbody><tr><td style="--size:30px;font-size:var(--size, 20px)"><p style="font-size:150%">变量字号</p></td></tr></tbody></table>',
  );
  await expect(merged.getByText("变量字号")).toHaveCSS("font-size", "45px");
  const variableSize = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  expect(variableSize.html).toContain("data-semlo-editor-cell-font-variables");
  for (const content of [variableSize.html, variableSize.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), content);
    await expect(merged.getByText("变量字号")).toHaveCSS("font-size", "45px");
  }
  await paste(
    '<table><tbody><tr style="--base:20px;font-size:var(--base)"><td style="font-size:150%"><p style="font-size:150%">变量相对链</p></td></tr></tbody></table>',
  );
  await expect(merged.getByText("变量相对链")).toHaveCSS("font-size", "45px");
  const variableChain = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  for (const content of [variableChain.html, variableChain.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), content);
    await expect(merged.getByText("变量相对链")).toHaveCSS("font-size", "45px");
  }
  await paste(
    '<table><tbody><tr style="font-size:calc(10px + 10px)"><td style="font-size:150%">计算相对链</td></tr></tbody></table>',
  );
  await expect(merged.getByText("计算相对链")).toHaveCSS("font-size", "30px");
  await paste(
    yuque(
      '<table><tbody><tr><td style="font-weight:bold"><p style="font-weight:normal">正常<strong>粗</strong></p></td></tr></tbody></table>',
    ),
  );
  await expect(merged.locator("strong")).toHaveText("正常粗");
  await paste(
    '<table><tbody><tr><td style="font-weight:bold"><p style="font-weight:normal">正常<strong>粗</strong></p></td></tr></tbody></table>',
  );
  await expect(merged.locator("strong")).toHaveText("粗");
  await paste('<table><tbody><tr><td style="text-decoration:underline line-through">装饰</td></tr></tbody></table>');
  await expect(merged.locator("u")).toHaveText("装饰");
  await expect(merged.locator("s")).toHaveText("装饰");
  await paste(
    '<ne-clipboard data="%7B%7D" source="https%3A%2F%2Fwww.yuque.com%2Fexample"></ne-clipboard><div class="lake-content"><table><tbody><tr><td style="font-family:Georgia"><span style="font-family:Georgia">语雀来源</span></td></tr></tbody></table></div>',
  );
  await expect(merged).toHaveText("语雀来源");
  await expect(merged.locator('[style*="font-family"]')).toHaveCount(0);
  await paste('<table><tbody><tr><td><span style="font-family:Georgia">来源未知</span></td></tr></tbody></table>');
  await expect(merged.getByText("来源未知")).toHaveCSS("font-family", "Georgia");
  await paste(
    '<ne-clipboard source="https%3A%2F%2Fexample.com%2Fdoc"></ne-clipboard><table><tbody><tr><td><span style="font-family:Georgia">其他来源</span></td></tr></tbody></table>',
  );
  await expect(merged.getByText("其他来源")).toHaveCSS("font-family", "Georgia");
  await paste(
    '<table><tbody><tr><td style="font-family:Georgia;font-size:150%">未知单元格样式</td></tr></tbody></table>',
  );
  await expect(merged.getByText("未知单元格样式")).toHaveCSS("font-family", "Georgia");
  expect((await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot())).html).toContain(
    "font-size: 150%",
  );
  await paste(
    '<table><tbody style="font-family:Georgia;font-size:20px"><tr><td>未知行组样式</td></tr></tbody></table>',
  );
  await expect(merged.getByText("未知行组样式")).toHaveCSS("font-family", "Georgia");
  await expect(merged.getByText("未知行组样式")).toHaveCSS("font-size", "20px");
  await paste(
    '<table><tbody><tr><td style="--font:Georgia;font-family:var(--font)">变量字体</td></tr></tbody></table>',
  );
  await expect(merged.getByText("变量字体")).toHaveCSS("font-family", "Georgia");
  const variableFont = await page.evaluate(() => window.__semloRequireFixture("tablePasteEditor").getSnapshot());
  for (const content of [variableFont.html, variableFont.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), content);
    await expect(merged.getByText("变量字体")).toHaveCSS("font-family", "Georgia");
  }
  await paste('<table><tbody><tr><td style="--1font:20px;font-size:var(--1font)">数字变量</td></tr></tbody></table>');
  await expect(merged.getByText("数字变量")).toHaveCSS("font-size", "20px");
  await paste(
    yuque(
      '<table><tbody><tr><td style="line-height:2"><img src="/tests/sample-image.svg" alt="图片"></td></tr></tbody></table>',
    ),
  );
  const image = await page.evaluate(
    () =>
      window.__semloRequireFixture("tablePasteEditor").getSnapshot().json.content?.[0].content?.[0].content?.[0]
        .content?.[0].content?.[0],
  );
  expect(image).toMatchObject({ type: "image", attrs: { src: "/tests/sample-image.svg", alt: "图片" } });
  await page.evaluate((value) => window.__semloRequireFixture("tablePasteEditor").setContent(value), before.json);
  await prose.getByText("后文", { exact: true }).click();
  await page.keyboard.press("End");
  await page.evaluate(() => {
    const clipboard = new DataTransfer();
    clipboard.setData(
      "text/html",
      '<table><tbody><tr><td style="text-align:center;vertical-align:bottom">外部表格</td></tr></tbody></table>',
    );
    clipboard.setData("text/plain", "外部表格");
    window
      .__semloRequireFixture("tablePasteEditor")
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }),
      );
  });
  const inserted = prose.getByRole("cell", { name: "外部表格", exact: true });
  await expect(inserted).toHaveCSS("vertical-align", "bottom");
  await expect(inserted.locator("p")).toHaveCSS("text-align", "center");
});
