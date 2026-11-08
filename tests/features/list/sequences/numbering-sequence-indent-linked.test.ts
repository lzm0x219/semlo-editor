import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { startFixtureServer } from "../../../fixtures/browser/fixture-rsbuild";

let origin = "",
  stop = async () => {};
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/list/task-item-conversion-fixture.ts"));
});
afterAll(async () => stop());
test.afterEach(async ({ page }) => page.evaluate(() => window.taskConversionEditor?.destroy()));

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function segment(version: number, start: number, previous: string, next: string, ...texts: string[]): JSONContent {
  return {
    type: "orderedList",
    attrs: {
      semloEditorListSequenceLink: `v${version}:${previous}:${next}`,
      semloEditorListSequences: {
        version: 1,
        sequences: [{ id: "root", start, origin: "initial" }],
      },
    },
    content: texts.map((text) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: 0, semloEditorListSequence: "root" },
      content: [paragraph(text)],
    })),
  };
}

async function mount(page: Page, version: 1 | 2 | 3) {
  page.setDefaultTimeout(5000);
  await page.goto(origin);
  const secondGap: JSONContent =
    version === 1
      ? paragraph("间隔二")
      : version === 2
        ? {
            type: "taskList",
            content: [{ type: "taskItem", attrs: { checked: false }, content: [paragraph("间隔二")] }],
          }
        : { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "间隔二" }] };
  await page.evaluate(
    (content) => {
      const element = document.createElement("div");
      element.id = "linked-indent";
      document.body.append(element);
      window.taskConversionEditor = window.taskConversionCreate!({
        element,
        outline: false,
        content: { type: "doc", content },
        onChange: (snapshot) => window.taskConversionEditor!.setContent(snapshot.html),
      });
    },
    [
      segment(version, 1, "_", "first", "甲", "乙"),
      paragraph("间隔一"),
      segment(version, 3, "first", "second", "丙", "丁"),
      secondGap,
      segment(version, 5, "second", "_", "戊", "己"),
    ],
  );
  return page.locator("#linked-indent .tiptap");
}

const snapshot = (page: Page) => page.evaluate(() => window.taskConversionEditor!.getSnapshot());
const values = (page: Page) =>
  page
    .locator("#linked-indent .tiptap ol > li")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLLIElement).value));

for (const sample of [
  { version: 1, target: "乙", expected: [1, 1, 2, 3, 4, 5] },
  { version: 1, target: "丁", expected: [1, 2, 3, 1, 4, 5] },
  { version: 2, target: "丁", expected: [1, 2, 3, 1, 4, 5] },
  { version: 3, target: "乙", expected: [1, 1, 2, 3, 4, 5] },
  { version: 3, target: "己", expected: [1, 2, 3, 4, 5, 1] },
] as const) {
  test(`v${sample.version} 续接中调整 ${sample.target} 的层级后更新其余片段`, async ({ page }) => {
    const prose = await mount(page, sample.version);
    const before = await snapshot(page);
    expect(await values(page)).toEqual([1, 2, 3, 4, 5, 6]);
    await prose.getByText(sample.target, { exact: true }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    const after = await snapshot(page);
    expect(await values(page)).toEqual(sample.expected);
    expect(
      after.json
        .content!.filter((node) => node.type === "orderedList")
        .map((node) => node.attrs?.semloEditorListSequenceLink),
    ).toEqual([`v${sample.version}:_:first`, `v${sample.version}:first:second`, `v${sample.version}:second:_`]);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.redo())).toBe(true);
    expect((await snapshot(page)).json).toEqual(after.json);
    await prose.getByText(sample.target, { exact: true }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+Tab");
    expect(await values(page)).toEqual([1, 2, 3, 4, 5, 6]);
    await page.evaluate((html) => window.taskConversionEditor!.setContent(html), after.html);
    expect((await snapshot(page)).json).toEqual(after.json);
  });
}

test("续接片段中已有相同名称的序列时不错误联动", async ({ page }) => {
  const prose = await mount(page, 1);
  const content = (await snapshot(page)).json;
  const tail = content.content![4];
  const registry = tail.attrs!.semloEditorListSequences as {
    sequences: Array<{ id: string; start: number; origin: string }>;
  };
  registry.sequences.push({ id: "indent-1", start: 1, origin: "restart" });
  tail.content![1].attrs!.semloEditorListSequence = "indent-1";
  await page.evaluate((value) => window.taskConversionEditor!.setContent(value), content);
  const before = await snapshot(page);
  expect(await values(page)).toEqual([1, 2, 3, 4, 5, 1]);
  await prose.getByText("乙", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  const after = await snapshot(page);
  expect(after.json.content![0].content![1].attrs?.semloEditorListSequence).toBe("indent-2");
  expect(after.json.content![4].content![1].attrs?.semloEditorListSequence).toBe("indent-1");
  expect(await values(page)).toEqual([1, 1, 2, 3, 4, 1]);
  expect(await page.evaluate(() => window.taskConversionEditor!.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("当前片段没有剩余成员可核实来源时保留续接和正文", async ({ page }) => {
  const prose = await mount(page, 1);
  const content = (await snapshot(page)).json;
  content.content![2].content!.pop();
  const tail = content.content![4].attrs!.semloEditorListSequences as {
    sequences: Array<{ start: number }>;
  };
  tail.sequences[0].start = 4;
  await page.evaluate((value) => window.taskConversionEditor!.setContent(value), content);
  const before = await snapshot(page);
  await prose.getByText("丙", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await values(page)).toEqual([1, 2, 3, 4, 5]);
});
