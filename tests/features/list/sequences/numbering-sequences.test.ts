import { beforeAll, afterAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../../fixtures/browser/fixture-rsbuild";
import {
  mountSequence,
  dragSequence,
  readSequence,
  historySequence,
  numberingMenu,
} from "../../../fixtures/list/sequences/browser-helpers";

let origin = "",
  stop = async () => {};
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer(
    "./tests/fixtures/list/sequences/numbering-sequences-framework-fixture.ts",
    { framework: true },
  ));
});
afterAll(async () => stop());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

test("三子项前移后继续合回后面的 initial，菜单资格跟随当前首成员", async ({ page }) => {
  const prose = await mountSequence(page, origin);
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("甲", { exact: true }), true);
  await expect(prose.locator("ol > li p")).toHaveText(["父", "乙", "甲", "丙"]);
  expect((await readSequence(page)).values).toEqual([1, 1, 1, 2]);
  const before = await readSequence(page);
  const menu = await numberingMenu(page, "乙");
  await expect(menu.getByRole("menuitem", { name: "重新编号", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "继续编号", exact: true })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "继续编号", exact: true }).click();
  expect((await readSequence(page)).values).toEqual([1, 1, 2, 3]);
  await historySequence(page, "undo");
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
});

test("五项交错的后缀重启/继续、Enter 和删除只影响自身序列", async ({ page }) => {
  const prose = await mountSequence(page, origin, "core", "five");
  await dragSequence(page, prose.getByText("丁", { exact: true }), prose.getByText("甲", { exact: true }), true);
  await expect(prose.locator("ol > li p")).toHaveText(["父", "丁", "甲", "乙", "丙", "戊"]);
  expect((await readSequence(page)).values).toEqual([1, 1, 1, 1, 2, 2]);
  const menu = await numberingMenu(page, "甲");
  await expect(menu.getByRole("menuitem", { name: "继续编号", exact: true })).toBeDisabled();
  await menu.getByRole("menuitem", { name: "重新编号", exact: true }).click();
  await numberingMenu(page, "甲", "继续编号");
  expect((await readSequence(page)).values).toEqual([1, 1, 2, 1, 2, 3]);
  await prose.getByText("丁", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("新");
  await expect(prose.locator("ol > li p")).toHaveText(["父", "丁", "新", "甲", "乙", "丙", "戊"]);
  expect((await readSequence(page)).values).toEqual([1, 1, 2, 3, 1, 2, 4]);
  const inserted = await readSequence(page);
  await prose.getByText("新", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page
    .getByRole("menu", { name: "块操作", exact: true })
    .getByRole("menuitem", { name: "删除", exact: true })
    .click();
  expect((await readSequence(page)).values).toEqual([1, 1, 2, 1, 2, 3]);
  await historySequence(page, "undo");
  expect((await readSequence(page)).snapshot.json).toEqual(inserted.snapshot.json);
  await numberingMenu(page, "甲", "重新编号");
  expect((await readSequence(page)).values).toEqual([1, 1, 2, 1, 1, 2, 2]);
  await numberingMenu(page, "甲", "继续编号");
  expect((await readSequence(page)).values).toEqual([1, 1, 2, 3, 1, 2, 4]);
});

test("新首成员丙拥有继续资格，原 restart 源乙成为普通成员", async ({ page }) => {
  const prose = await mountSequence(page, origin);
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("丙", { exact: true }), false);
  let menu = await numberingMenu(page, "乙");
  await expect(menu.getByRole("menuitem", { name: "继续编号", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "重新编号", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  menu = await numberingMenu(page, "丙");
  await expect(menu.getByRole("menuitem", { name: "重新编号", exact: true })).toBeDisabled();
  await menu.getByRole("menuitem", { name: "继续编号", exact: true }).click();
  expect((await readSequence(page)).values).toEqual([1, 1, 2, 3]);
});

test("v1 支持 Tab 后撤销，未支持的转换及带子项拖动保留正文", async ({ page }) => {
  const prose = await mountSequence(page, origin);
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("丙", { exact: true }), false);
  const before = await readSequence(page);
  await prose.getByText("乙", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  expect((await readSequence(page)).snapshot.json).not.toEqual(before.snapshot.json);
  await historySequence(page, "undo");
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
  const results = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceFixture").controller.editor;
    return [editor.commands.toggleTaskList(), editor.commands.toggleBlockquote()];
  });
  expect(results).toHaveLength(2);
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
  await prose.getByText("乙", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page
    .getByRole("menu", { name: "块操作", exact: true })
    .getByRole("menuitem", { name: "转化为", exact: true })
    .hover();
  // 具体标题入口由块菜单验证；没有安全转换时保持原文档。
  const heading = page.getByRole("menuitem", { name: "标题 2", exact: true });
  await expect(heading).toBeDisabled();
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
  await page.keyboard.press("Escape");
  await dragSequence(page, prose.getByText("父", { exact: true }), prose.getByText("乙", { exact: true }), false);
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
  await prose.getByText("乙", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("改");
  expect((await readSequence(page)).values).toEqual([1, 1, 1, 2]);
});

test("选中多个编号项后 Tab 一次调整层级并可撤销", async ({ page }) => {
  const prose = await mountSequence(page, origin, "core", "three", "html");
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("丙", { exact: true }), false);
  const before = await readSequence(page);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceFixture").controller.editor;
    const positions = new Map<string, { from: number; to: number }>();
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && ["甲", "乙"].includes(node.textContent))
        positions.set(node.textContent, { from: pos + 1, to: pos + 1 + node.content.size });
    });
    editor.commands.focus();
    editor.commands.setTextSelection({ from: positions.get("甲")!.from, to: positions.get("乙")!.to });
  });
  await page.keyboard.press("Tab");
  const after = await readSequence(page);
  expect(after.snapshot.json.content![1].content!.map((item) => item.attrs?.semloEditorListIndent)).toEqual([
    0, 2, 2, 2,
  ]);
  expect(after.values).toEqual([1, 1, 1, 2]);
  await historySequence(page, "undo");
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
  await historySequence(page, "redo");
  expect((await readSequence(page)).snapshot.json).toEqual(after.snapshot.json);
  await page.keyboard.press("Shift+Tab");
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
});

test("JSON/HTML 损坏关系拒绝且保留原内容；快照 registry 无别名", async ({ page }) => {
  const prose = await mountSequence(page, origin);
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("丙", { exact: true }), false);
  const before = await readSequence(page);
  await page.evaluate(async () => {
    const fixture = window.__semloRequireFixture("sequenceFixture"),
      snapshot = fixture.controller.getSnapshot();
    const list = snapshot.json.content!.find((node) => node.type === "orderedList")!;
    (list.attrs!.semloEditorListSequences as { sequences: Array<{ start: number }> }).sequences[0].start = 77;
    list.content![1].attrs!.semloEditorListSequence = "missing";
    fixture.setContent(snapshot.json);
    await fixture.settle();
  });
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
  await page.evaluate(async (html) => {
    const fixture = window.__semloRequireFixture("sequenceFixture");
    fixture.setContent(html.replace('data-semlo-editor-list-sequence="', 'data-semlo-editor-list-sequence="missing-'));
    await fixture.settle();
  }, before.snapshot.html);
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
  expect((await readSequence(page)).errors.length).toBeGreaterThan(0);
});

test("HTML 大小写混合/全大写属性放在非列表元素不能被静默丢弃", async ({ page }) => {
  await mountSequence(page, origin);
  const before = await readSequence(page);
  for (const html of [
    `<p DATA-SEMLO-EDITOR-LIST-SEQUENCES='{"version":1,"sequences":[]}'>坏内容</p>`,
    '<div DATA-SEMLO-EDITOR-LIST-SEQUENCE="A"><p>坏内容</p></div>',
    '<p Data-Semlo-Editor-List-Sequence="A">坏内容</p>',
  ]) {
    await page.evaluate(async (html) => {
      const fixture = window.__semloRequireFixture("sequenceFixture");
      fixture.setContent(html);
      await fixture.settle();
    }, html);
    expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
  }
  expect((await readSequence(page)).errors).toHaveLength(3);
});

test("块下方插入同级项、输入和写作一次插入正文继承局部序列", async ({ page }) => {
  const prose = await mountSequence(page, origin);
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("丙", { exact: true }), false);
  const openBelow = async () => {
    await prose.getByText("丙", { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page
      .getByRole("menu", { name: "块操作", exact: true })
      .getByRole("menuitem", { name: "在下方添加", exact: true })
      .click();
  };
  const before = await readSequence(page);
  await openBelow();
  await page
    .getByRole("dialog", { name: "插入内容" })
    .locator('.semlo-editor-card-item[data-command="status"]')
    .click();
  await page.keyboard.press("Escape");
  await prose
    .locator("ol > li p")
    .nth(3)
    .click({ position: { x: 200, y: 10 } });
  await page.keyboard.press("End");
  await page.keyboard.insertText("新");
  await expect(prose.locator("ol > li p")).toHaveCount(5);
  await expect(prose.locator("ol > li p").nth(3)).toContainText("新");
  expect((await readSequence(page)).values).toEqual([1, 1, 1, 2, 3]);
  await historySequence(page, "undo");
  // 输入与新增项可属于各自的历史事件；回到原始列表后验证写作插入。
  if ((await readSequence(page)).texts.length !== before.texts.length) await historySequence(page, "undo");
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
  await page.evaluate(() =>
    window
      .__semloRequireFixture("sequenceFixture")
      .controller.setIntegrations({ writingService: async () => ({ format: "text", text: "写作新增" }) }),
  );
  await openBelow();
  await page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="ai"]').click();
  await page.getByLabel("向智能助手提问", { exact: true }).fill("新增同级正文");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("写作新增");
  expect(await page.evaluate(() => window.__semloRequireFixture("sequenceFixture").writing!.accept())).toBe("applied");
  await expect(prose.locator("ol > li p")).toHaveText(["父", "甲", "丙", "写作新增", "乙"]);
  expect((await readSequence(page)).values).toEqual([1, 1, 1, 2, 3]);
  await historySequence(page, "undo");
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
  await historySequence(page, "redo");
  expect((await readSequence(page)).values).toEqual([1, 1, 1, 2, 3]);
});

test("整列表/同段复制保留，跨项copy独立投影、边界cut保空首项与历史", async ({ page }) => {
  const prose = await mountSequence(page, origin);
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("丙", { exact: true }), false);
  const before = await readSequence(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          Reflect.set(window, "sequenceCopiedHTML", await (await items[0].getType("text/html")).text());
        },
      },
    }),
  );
  await prose.getByText("父", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page
    .getByRole("menu", { name: "块操作", exact: true })
    .getByRole("menuitem", { name: "复制", exact: true })
    .click();
  await page.waitForFunction(() => typeof Reflect.get(window, "sequenceCopiedHTML") === "string");
  const copied = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("sequenceFixture"),
      html = Reflect.get(window, "sequenceCopiedHTML") as string;
    const sibling = fixture.mountSibling(html);
    return {
      snapshot: sibling.getSnapshot(),
      values: [...sibling.editor.view.dom.querySelectorAll("ol > li")].map((item) => (item as HTMLLIElement).value),
      html,
    };
  });
  expect(copied.html).toContain("data-semlo-editor-list-sequences");
  expect(copied.values).toEqual([1, 1, 1, 2]);
  expect(copied.snapshot.json.content?.[0]).toEqual(
    before.snapshot.json.content?.find((node) => node.type === "orderedList"),
  );
  await page.keyboard.press("Escape");
  const clipboard = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("sequenceFixture").controller.editor;
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && ["丙", "乙"].includes(node.textContent)) positions.push(pos + 1);
    });
    const copy = (from: number, to: number, cut = false) => {
      editor.commands.setTextSelection({ from, to });
      const data = new DataTransfer();
      data.setData("text/plain", "sentinel");
      data.setData("text/html", "sentinel");
      const event = new ClipboardEvent(cut ? "cut" : "copy", { clipboardData: data, bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      return { html: data.getData("text/html"), plain: data.getData("text/plain"), prevented: event.defaultPrevented };
    };
    return {
      inline: copy(positions[0], positions[0] + 1),
      partial: copy(positions[0], positions[1] + 1),
      cut: copy(positions[0], positions[1] + 1, true),
    };
  });
  expect(clipboard.inline.plain).toBe("丙");
  expect(clipboard.inline.html).not.toContain("list-sequence");
  expect(clipboard.partial.plain).toBe("  a. 丙\n  b. 乙");
  expect(clipboard.partial.html).not.toContain("list-sequence");
  expect(clipboard.partial.html).toContain('data-pm-slice="0 0');
  expect(clipboard.partial.prevented).toBe(true);
  expect(clipboard.cut.plain).toBe("  a. 丙\n  b. 乙");
  expect(clipboard.cut.html).not.toContain("list-sequence");
  expect(clipboard.cut.prevented).toBe(true);
  await expect(prose.locator("ol > li p")).toHaveText(["父", "甲", ""]);
  await historySequence(page, "undo");
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
  await prose.getByText("乙", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("改");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceFixture").siblings[0].getSnapshot().json),
  ).toEqual(copied.snapshot.json);
  await page.evaluate(() => window.__semloRequireFixture("sequenceFixture").destroy());
  await expect(page.locator("#sequence-fixture, #sequence-sibling")).toHaveCount(0);
});

test("v1 首子项无前驱的重启和继续保存 origin，根级首项菜单仍受保护", async ({ page }) => {
  const prose = await mountSequence(page, origin);
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("丙", { exact: true }), false);
  await numberingMenu(page, "丙", "继续编号");
  const initial = await readSequence(page);
  expect(initial.values).toEqual([1, 1, 2, 3]);
  await expect(page.getByRole("button", { name: "设置列表编号：父", exact: true })).toHaveCount(0);
  let menu = await numberingMenu(page, "甲");
  await expect(menu.getByRole("menuitem", { name: "重新编号", exact: true })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "继续编号", exact: true })).toBeDisabled();
  await menu.getByRole("menuitem", { name: "重新编号", exact: true }).click();
  const restarted = await readSequence(page);
  expect(restarted.values).toEqual(initial.values);
  expect(restarted.snapshot.json).not.toEqual(initial.snapshot.json);
  expect(restarted.documentChanges).toBe(initial.documentChanges + 1);
  menu = await numberingMenu(page, "甲");
  await expect(menu.getByRole("menuitem", { name: "重新编号", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "继续编号", exact: true })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "继续编号", exact: true }).click();
  const continued = await readSequence(page);
  expect(continued.values).toEqual(initial.values);
  expect(continued.snapshot.json).not.toEqual(restarted.snapshot.json);
  expect(continued.documentChanges).toBe(restarted.documentChanges + 1);
  await historySequence(page, "undo");
  expect((await readSequence(page)).snapshot.json).toEqual(restarted.snapshot.json);
});

test("v1 父项折叠和展开只改变展示属性，编号序列不受阻", async ({ page }) => {
  const prose = await mountSequence(page, origin);
  await dragSequence(page, prose.getByText("乙", { exact: true }), prose.getByText("丙", { exact: true }), false);
  const before = await readSequence(page);
  await page.getByRole("button", { name: "折叠列表项：父", exact: true }).click();
  const folded = await readSequence(page);
  expect(
    folded.snapshot.json.content?.find((node) => node.type === "orderedList")?.content?.[0].attrs
      ?.semloEditorListFolded,
  ).toBe(true);
  expect(folded.values).toEqual(before.values);
  await page.getByRole("button", { name: "展开列表项：父", exact: true }).click();
  expect((await readSequence(page)).snapshot.json).toEqual(before.snapshot.json);
});
