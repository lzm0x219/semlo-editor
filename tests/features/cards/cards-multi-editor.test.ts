import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/cards/cards-multi-editor-fixture";

let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/cards/cards-multi-editor-fixture.ts"));
});
afterAll(async () => closeServer?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

test("replacing another editor does not disturb a calendar date draft", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  const second = page.locator('[data-editor-name="乙"]');
  await first.getByRole("button", { name: "日程：甲日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  const start = dialog.getByLabel("开始日期");
  await start.click();
  await start.fill("2026-11-12");
  await page.evaluate(() => {
    const secondEditor = window.__semloRequireFixture("cardMultiEditors")[1];
    const json = secondEditor.getSnapshot().json;
    json.content![0].content![0].text = "乙的新正文";
    json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0].title = "乙的新日程";
    secondEditor.setContent(json);
  });
  await expect(second.getByRole("button", { name: "日程：乙的新日程" }).first()).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(start).toBeFocused();
  await expect(start).toHaveValue("2026-11-12");
  await start.press("Enter");
  const end = dialog.getByLabel("结束日期");
  await end.fill("2026-11-13");
  await end.press("Enter");
  const snapshots = await page.evaluate(() =>
    window.__semloRequireFixture("cardMultiEditors").map((editor) => editor.getSnapshot().json),
  );
  const events = snapshots.map(
    (json) => json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0],
  );
  expect(events[0].title).toBe("甲日程");
  expect(events[0].start).toBe("2026-11-12");
  expect(events[0].end).toBe("2026-11-13");
  expect(events[1].title).toBe("乙的新日程");
  expect(events[1].start).toBe("2026-11-05");
  expect(events[1].end).toBe("2026-11-05");
});

test("an appended whole-document replacement cannot commit a stale calendar date draft", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "日程：甲日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  const start = dialog.getByLabel("开始日期");
  await start.click();
  await start.fill("2026-11-12");
  await page.evaluate(() => window.__semloRequireFixture("appendCalendarDocumentReplacement")());
  await page.mouse.click(10, 10);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("cardMultiEditors")[0].getSnapshot().json);
  expect(snapshot.content?.[0].content?.[0].text).toBe("插件替换正文");
  const event = snapshot.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0];
  expect(event.title).toBe("甲日程");
  expect(event.start).toBe("2026-11-05");
  expect(event.end).toBe("2026-11-05");
});

for (const rootEdit of [false, true]) {
  test(`an appended whole-document restore with retained nodes preserves a calendar date draft (root edit: ${rootEdit})`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
    const first = page.locator('[data-editor-name="甲"]');
    await first.getByRole("button", { name: "日程：甲日程" }).first().click();
    const dialog = page.getByRole("dialog", { name: "编辑日程" });
    const start = dialog.getByLabel("开始日期");
    await start.click();
    await start.fill("2026-11-12");
    await page.evaluate(
      (rootEdit) => window.__semloRequireFixture("appendCalendarDocumentReplacement")(false, rootEdit, true),
      rootEdit,
    );
    await expect(dialog).toBeVisible();
    await expect(start).toBeFocused();
    await expect(start).toHaveValue("2026-11-12");
    await start.press("Enter");
    const end = dialog.getByLabel("结束日期");
    await end.fill("2026-11-13");
    await end.press("Enter");
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("cardMultiEditors")[0].getSnapshot().json);
    const event = snapshot.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0];
    expect(event.start).toBe("2026-11-12");
    expect(event.end).toBe("2026-11-13");
  });
}

test("explicit replacement of an equal calendar node discards the old date draft", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "日程：甲日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  const start = dialog.getByLabel("开始日期");
  await start.click();
  await start.fill("2026-11-12");
  await page.evaluate(() => window.__semloRequireFixture("replaceEqualCalendarNode")());
  await expect(dialog).toHaveCount(0);
  await first.getByRole("button", { name: "日程：甲日程" }).first().click();
  const fresh = page.getByRole("dialog", { name: "编辑日程" });
  await expect(fresh.getByLabel("开始日期")).toHaveValue("2026-11-05");
});

test("serialized equal document reconstruction discards the prior calendar draft conservatively", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "日程：甲日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByLabel("开始日期").click();
  await dialog.getByLabel("开始日期").fill("2026-11-12");
  await page.evaluate(() => window.__semloRequireFixture("appendCalendarDocumentReplacement")(false));
  await expect(dialog).toHaveCount(0);
  await first.getByRole("button", { name: "日程：甲日程" }).first().click();
  await expect(page.getByRole("dialog", { name: "编辑日程" }).getByLabel("开始日期")).toHaveValue("2026-11-05");
});

test("an ordinary neighboring text edit preserves a live calendar date draft", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "日程：甲日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  const start = dialog.getByLabel("开始日期");
  await start.click();
  await start.fill("2026-11-12");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
    editor.view.dispatch(editor.state.tr.insertText("新增", 1));
  });
  await expect(dialog).toBeVisible();
  await expect(start).toBeFocused();
  await expect(start).toHaveValue("2026-11-12");
  await start.press("Enter");
  const end = dialog.getByLabel("结束日期");
  await end.fill("2026-11-13");
  await end.press("Enter");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("cardMultiEditors")[0].getSnapshot().json);
  expect(snapshot.content?.[0].content?.[0].text).toBe("新增甲正文");
  const event = snapshot.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0];
  expect(event.start).toBe("2026-11-12");
  expect(event.end).toBe("2026-11-13");
});

test("nested transaction during equal node replacement cannot keep a stale calendar draft", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "日程：甲日程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByLabel("开始日期").click();
  await dialog.getByLabel("开始日期").fill("2026-11-12");
  await page.evaluate(() => window.__semloRequireFixture("replaceEqualCalendarNode")(true));
  expect(await page.evaluate(() => window.cardNestedTransactions)).toBe(1);
  expect(await page.evaluate(() => window.cardPopupDuringReentry)).toBe(true);
  await expect(dialog).toHaveCount(0);
  await first.getByRole("button", { name: "日程：甲日程" }).first().click();
  await expect(page.getByRole("dialog", { name: "编辑日程" }).getByLabel("开始日期")).toHaveValue("2026-11-05");
});

test("replacing another editor does not close or retarget a date picker with the same id", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  const second = page.locator('[data-editor-name="乙"]');
  await first.getByRole("button", { name: "日期：2026-11-03" }).click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("cardMultiEditors")[1];
    const json = controller.getSnapshot().json;
    json.content![0].content![0].text = "乙的新正文";
    const date = json.content![1].content![0];
    date.attrs!.date = "2027-02-04";
    controller.setContent(json);
  });
  await expect(picker).toBeVisible();
  await expect(second.getByRole("button", { name: "日期：2027-02-04" })).toBeVisible();
  await picker.getByRole("button", { name: "2026-11-05", exact: true }).click();
  await expect(first.getByRole("button", { name: "日期：2026-11-05" })).toBeVisible();
  await expect(second.getByRole("button", { name: "日期：2027-02-04" })).toBeVisible();
});

for (const focused of ["甲", "乙"] as const) {
  test(`Escape closes only the focused ${focused} calendar event editor`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
    const first = page.locator('[data-editor-name="甲"]');
    const second = page.locator('[data-editor-name="乙"]');
    await first.getByRole("button", { name: "日程：甲日程" }).first().click();
    await second.getByRole("button", { name: "日程：乙日程" }).first().focus();
    await page.keyboard.press("Enter");
    const dialogs = page.getByRole("dialog", { name: "编辑日程" });
    await expect(dialogs).toHaveCount(2);
    const active = dialogs.filter({ has: page.getByLabel("日程标题") }).nth(focused === "甲" ? 0 : 1);
    await active.getByLabel("日程标题").focus();
    await page.keyboard.press("Escape");
    await expect(dialogs).toHaveCount(1);
    await expect(dialogs.first().getByLabel("日程标题")).toHaveValue(focused === "甲" ? "乙日程" : "甲日程");
  });
}

test("Escape in a calendar range picker closes only its owning event editor", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "日程：甲日程" }).first().click();
  await page.locator('[data-editor-name="乙"]').getByRole("button", { name: "日程：乙日程" }).first().focus();
  await page.keyboard.press("Enter");
  const dialogs = page.getByRole("dialog", { name: "编辑日程" });
  await expect(dialogs).toHaveCount(2);
  await dialogs.nth(1).getByLabel("开始日期").focus();
  await page.keyboard.press("Enter");
  const picker = dialogs.nth(1).getByRole("dialog", { name: "选择日程日期范围" });
  await picker.getByRole("button", { name: "上个月" }).focus();
  await page.keyboard.press("Escape");
  await expect(dialogs).toHaveCount(1);
  await expect(dialogs.first().getByLabel("日程标题")).toHaveValue("甲日程");
});

test("Escape in another editor's date picker leaves the calendar event editor open", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "日程：甲日程" }).first().click();
  await page.locator('[data-editor-name="乙"]').getByRole("button", { name: "日期：2026-11-03" }).focus();
  await page.keyboard.press("Enter");
  const eventDialog = page.getByRole("dialog", { name: "编辑日程" });
  const dateDialog = page.getByRole("dialog", { name: "选择日期" });
  await expect(eventDialog).toBeVisible();
  await expect(dateDialog).toBeVisible();
  const button = dateDialog.getByRole("button").first();
  await button.evaluate((element) => {
    element.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") element.dataset.escapeReceived = "true";
    });
  });
  await button.focus();
  await page.keyboard.press("Escape");
  await expect(eventDialog).toBeVisible();
  await expect(dateDialog).toBeVisible();
  await expect(button).toHaveAttribute("data-escape-received", "true");
});

for (const focused of [0, 1])
  test(`Escape in status editor ${focused} leaves the other open`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 2200 });
    await page.goto(origin);
    await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
    const first = page.locator('[data-editor-name="甲"]');
    const second = page.locator('[data-editor-name="乙"]');
    await first.getByRole("button", { name: "状态：甲状态" }).click();
    await second.getByRole("button", { name: "状态：乙状态" }).focus();
    await page.keyboard.press("Enter");
    const panels = page.getByRole("dialog", { name: "编辑状态" });
    await expect(panels).toHaveCount(2);
    await panels.nth(focused).getByLabel("状态文字").focus();
    await page.keyboard.press("Escape");
    await expect(panels).toHaveCount(1);
    await expect(panels.first().getByLabel("状态文字")).toHaveValue(focused === 0 ? "乙状态" : "甲状态");
  });

for (const kind of ["date", "calendar"] as const) {
  test(`Escape in ${kind} does not close another editor's status panel`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 2200 });
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
    const first = page.locator('[data-editor-name="甲"]');
    const second = page.locator('[data-editor-name="乙"]');
    await first.getByRole("button", { name: "状态：甲状态" }).click();
    await second
      .getByRole("button", { name: kind === "date" ? "日期：2026-11-03" : "日程：乙日程" })
      .first()
      .focus();
    await page.keyboard.press("Enter");
    const status = page.getByRole("dialog", { name: "编辑状态" });
    const other = page.getByRole("dialog", { name: kind === "date" ? "选择日期" : "编辑日程" });
    await expect(status).toBeVisible();
    await expect(other).toBeVisible();
    await (kind === "date" ? other.getByRole("button").first() : other.getByLabel("日程标题")).focus();
    await page.keyboard.press("Escape");
    await expect(status).toBeVisible();
    if (kind === "date") await expect(other).toBeVisible();
    else await expect(other).toHaveCount(0);
  });
}

test("Escape in status closes it without closing another calendar panel", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 2200 });
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  const second = page.locator('[data-editor-name="乙"]');
  await first.getByRole("button", { name: "日程：甲日程" }).first().click();
  await second.getByRole("button", { name: "状态：乙状态" }).focus();
  await page.keyboard.press("Enter");
  const status = page.getByRole("dialog", { name: "编辑状态" });
  const calendar = page.getByRole("dialog", { name: "编辑日程" });
  await expect(status).toBeVisible();
  await expect(calendar).toBeVisible();
  await status.getByLabel("状态文字").focus();
  await page.keyboard.press("Escape");
  await expect(status).toHaveCount(0);
  await expect(calendar).toBeVisible();
});

for (const key of ["Escape", "ControlOrMeta+Enter"]) {
  test(`${key} in one formula does not close or commit another formula`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 2200 });
    await page.goto(origin);
    await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
    const first = page.locator('[data-editor-name="甲"]');
    const second = page.locator('[data-editor-name="乙"]');
    await first.getByRole("button", { name: "公式：x" }).click();
    await page.getByRole("dialog", { name: "编辑公式" }).getByLabel("TeX 公式").fill("x+1");
    await second.getByRole("button", { name: "公式：y" }).focus();
    await page.keyboard.press("Enter");
    const panels = page.getByRole("dialog", { name: "编辑公式" });
    await expect(panels).toHaveCount(2);
    await panels.nth(1).getByLabel("TeX 公式").fill("y+1");
    await page.keyboard.press(key);
    await expect(first.getByRole("button", { name: "公式：x+1", exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          window
            .__semloRequireFixture("cardMultiEditors")[0]
            .getSnapshot()
            .json.content![1].content!.find((n) => n.type === "semloEditorFormula")!.attrs!.latex,
      ),
    ).toBe("x");
    await expect(panels).toHaveCount(1);
    await expect(panels.first().getByLabel("TeX 公式")).toHaveValue("x+1");
    await expect(second.getByRole("button", { name: "公式：y+1", exact: true })).toBeVisible();
  });
}

test("formula composing keyboard events do not close or commit the editor", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "公式：x" }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  const input = panel.getByLabel("TeX 公式");
  await input.fill("x+1");
  for (const init of [
    { key: "Escape", isComposing: true },
    { key: "Enter", ctrlKey: true, keyCode: 229 },
  ]) {
    await input.evaluate(
      (element, init) => element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })),
      init,
    );
    await expect(panel).toBeVisible();
    await expect(first.getByRole("button", { name: "公式：x" })).toBeVisible();
  }
  await input.press("ControlOrMeta+Enter");
  await expect(panel).toHaveCount(0);
  await expect(first.getByRole("button", { name: "公式：x+1" })).toBeVisible();
});

test("formula commit tolerates synchronous host destruction", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "公式：x" }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await panel.getByLabel("TeX 公式").fill("x+1");
  await page.evaluate(() => Reflect.set(window, "destroyFormulaEditor", "甲"));
  await panel.getByRole("button", { name: "确定" }).click();
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("cardMultiEditors")[0].editor.isDestroyed)).toBe(true);
  expect(errors).toEqual([]);
});

for (const changed of [false, true]) {
  test(`replacing a ${changed ? "changed" : "equal"} formula closes the old draft`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
    const first = page.locator('[data-editor-name="甲"]');
    await first.getByRole("button", { name: "公式：x" }).click();
    const panel = page.getByRole("dialog", { name: "编辑公式" });
    await panel.getByLabel("TeX 公式").fill("x+1");
    await page.evaluate((changed) => {
      const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "semloEditorFormula") position = pos;
      });
      const node = editor.state.doc.nodeAt(position)!;
      const json = node.toJSON();
      if (changed) json.attrs!.latex = "z";
      editor.view.dispatch(
        editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(json)),
      );
    }, changed);
    await expect(panel).toHaveCount(0);
    await expect(first.getByRole("button", { name: changed ? "公式：z" : "公式：x" })).toBeVisible();
  });
}

test("adjacent edits and equal host echoes preserve a formula draft", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "公式：x" }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await panel.getByLabel("TeX 公式").fill("x+1");
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("cardMultiEditors")[0];
    controller.setContent(controller.getSnapshot().json);
    controller.editor.view.dispatch(controller.editor.state.tr.insertText("前文", 1));
  });
  await expect(panel.getByLabel("TeX 公式")).toHaveValue("x+1");
  await panel.getByRole("button", { name: "确定" }).click();
  await expect(first.getByRole("button", { name: "公式：x+1" })).toBeVisible();
});

test("rebuilding one equal formula leaves another formula draft intact", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.evaluate(() => {
    const formula = { type: "semloEditorFormula", attrs: { id: "same", latex: "x" } };
    window.__semloRequireFixture("cardMultiEditors")[0].setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [formula, { type: "text", text: " " }, formula] }],
    });
  });
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "公式：x" }).nth(1).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await panel.getByLabel("TeX 公式").fill("x+1");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorFormula" && position < 0) position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(
      editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
    );
  });
  await expect(panel.getByLabel("TeX 公式")).toHaveValue("x+1");
  await panel.getByRole("button", { name: "确定" }).click();
  await expect(first.getByRole("button", { name: "公式：x", exact: true })).toHaveCount(1);
  await expect(first.getByRole("button", { name: "公式：x+1", exact: true })).toHaveCount(1);
});

test("replacing one reused formula node does not retarget the other formula draft", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const sharedReference = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
    const formula = editor.schema.nodes.semloEditorFormula.create({ id: "same", latex: "x" });
    const paragraph = editor.schema.nodes.paragraph.create(null, [formula, editor.schema.text(" "), formula]);
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, paragraph));
    const nodes: unknown[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "semloEditorFormula") nodes.push(node);
    });
    return nodes.length === 2 && nodes[0] === nodes[1];
  });
  expect(sharedReference).toBe(true);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "公式：x", exact: true }).nth(1).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await panel.getByLabel("TeX 公式").fill("x+1");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorFormula" && position < 0) position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(
      editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
    );
  });
  await expect(panel.getByLabel("TeX 公式")).toHaveValue("x+1");
  await panel.getByRole("button", { name: "确定" }).click();
  await expect(first.getByRole("button", { name: "公式：x", exact: true })).toHaveCount(1);
  await expect(first.getByRole("button", { name: "公式：x+1", exact: true })).toHaveCount(1);
});

test("moving a formula cannot make its editor write to the old position", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.evaluate(() =>
    window.__semloRequireFixture("cardMultiEditors")[0].setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "semloEditorFormula", attrs: { id: "moving", latex: "x" } }] },
        { type: "paragraph", content: [{ type: "text", text: "后文" }] },
      ],
    }),
  );
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "公式：x", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorFormula") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const transaction = editor.state.tr.delete(position, position + node.nodeSize);
    transaction.insert(transaction.doc.content.size - 1, node);
    editor.view.dispatch(transaction);
  });
  if (!(await panel.isVisible())) await first.getByRole("button", { name: "公式：x", exact: true }).click();
  await panel.getByLabel("TeX 公式").fill("x+1");
  await panel.getByRole("button", { name: "确定" }).click();
  const json = await page.evaluate(() => window.__semloRequireFixture("cardMultiEditors")[0].getSnapshot().json);
  expect(json.content?.[0].content ?? []).toEqual([]);
  expect(json.content?.[1].content?.[0].text).toBe("后文");
  expect(json.content?.[1].content?.[1].attrs).toMatchObject({ id: "moving", latex: "x+1" });
});

test("switching a formula to read-only discards its pending draft", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "公式：x", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await panel.getByLabel("TeX 公式").fill("x+1");
  await page.evaluate(() => window.__semloRequireFixture("cardMultiEditors")[0].setEditable(false));
  await expect(panel).toHaveCount(0);
  await expect(first.getByRole("button", { name: "公式：x", exact: true })).toBeDisabled();
  await page.evaluate(() => window.__semloRequireFixture("cardMultiEditors")[0].setEditable(true));
  await first.getByRole("button", { name: "公式：x", exact: true }).click();
  await expect(panel.getByLabel("TeX 公式")).toHaveValue("x");
});

test("formula preview interaction keeps Escape usable", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "公式：x", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await panel.getByLabel("公式预览").click();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("formula preview text remains selectable", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "公式：x", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await panel.getByLabel("TeX 公式").fill(String.raw`\text{selectable preview}`);
  const text = panel.getByLabel("公式预览").locator(".katex-html");
  const box = await text.boundingBox();
  if (!box) throw new Error("Missing formula preview");
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const selection = await page.evaluate(() => window.getSelection()?.toString());
  expect(selection).toBeTruthy();
});

test("formula panel background interaction keeps Escape usable", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "公式：x", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await panel.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("formula preview focus retains the keyboard commit shortcut", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "公式：x", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await panel.getByLabel("TeX 公式").fill("x+1");
  await panel.getByLabel("公式预览").click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(panel).toHaveCount(0);
  await expect(first.getByRole("button", { name: "公式：x+1", exact: true })).toBeVisible();
});

test("formula panel remains inside the viewport after resizing", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "公式：x", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await panel.getByLabel("TeX 公式").fill("x+1");
  await page.setViewportSize({ width: 360, height: 600 });
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return Boolean(box && box.x >= 0 && box.x + box.width <= 360);
    })
    .toBe(true);
  await expect(panel.getByLabel("TeX 公式")).toHaveValue("x+1");
});

test("formula panel remains vertically usable in short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 160 });
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "公式：x", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  const box = await panel.boundingBox();
  if (!box) throw new Error("Missing formula panel");
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(160);
  await panel.getByLabel("TeX 公式").fill("x+1");
  await panel.getByRole("button", { name: "确定" }).click();
  await expect(
    page.locator('[data-editor-name="甲"]').getByRole("button", { name: "公式：x+1", exact: true }),
  ).toBeVisible();
});

test("growing a formula preview stays within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 300 });
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "公式：x", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "编辑公式" });
  await panel.getByLabel("TeX 公式").fill(String.raw`\begin{matrix} a \\ b \\ c \\ d \\ e \\ f \\ g \\ h \end{matrix}`);
  const box = await panel.boundingBox();
  if (!box) throw new Error("Missing formula panel");
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(300);
});

test("probe calendar event editor reflects synchronous host normalization", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  const first = page.locator('[data-editor-name="甲"]');
  await first.getByRole("button", { name: "日程：甲日程" }).first().click();
  const panel = page.getByRole("dialog", { name: "编辑日程" });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
    let done = false;
    editor.on("update", () => {
      if (done) return;
      done = true;
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "semloEditorCalendar") pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      const events = node.attrs.events.map((event: { title: string }) => ({ ...event, title: "规范后" }));
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, events }));
    });
  });
  await panel.getByLabel("日程标题").fill("进行中");
  await expect(first.getByRole("button", { name: "日程：规范后" }).first()).toBeVisible();
  const shown = await panel.getByLabel("日程标题").inputValue();
  await panel.getByLabel("日程说明").fill("补充说明");
  const event = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("cardMultiEditors")[0]
        .getSnapshot()
        .json.content!.find((n) => n.type === "semloEditorCalendar")!.attrs!.events[0],
  );
  expect(event.title).toBe("规范后");
  expect(shown).toBe("规范后");
});

for (const action of ["normalize-fields", "remove-event", "replace-equal"] as const) {
  test(`candidate calendar draft handles synchronous host ${action}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
    const first = page.locator('[data-editor-name="甲"]');
    await first.getByRole("button", { name: "日程：甲日程" }).first().click();
    const panel = page.getByRole("dialog", { name: "编辑日程" });
    await page.evaluate((action) => {
      const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
      let done = false;
      editor.on("update", () => {
        if (done) return;
        done = true;
        let pos = -1;
        editor.state.doc.descendants((node, at) => {
          if (node.type.name === "semloEditorCalendar") pos = at;
        });
        const node = editor.state.doc.nodeAt(pos)!;
        const events =
          action === "remove-event"
            ? []
            : node.attrs.events.map((event: Record<string, unknown>) =>
                action === "normalize-fields"
                  ? { ...event, start: "2026-11-09", end: "2026-11-10", description: "规范说明", color: 6 }
                  : event,
              );
        const tr =
          action === "replace-equal"
            ? editor.state.tr.replaceWith(pos, pos + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON()))
            : editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, events });
        editor.view.dispatch(tr);
      });
    }, action);
    await panel.getByLabel("日程标题").fill("新标题");
    if (action === "normalize-fields") {
      await expect(panel.getByLabel("开始日期")).toHaveValue("2026-11-09");
      await expect(panel.getByLabel("结束日期")).toHaveValue("2026-11-10");
      await expect(panel.getByLabel("日程说明")).toHaveValue("规范说明");
      await panel.getByLabel("日程说明").fill("进一步说明");
      const event = await page.evaluate(
        () =>
          window
            .__semloRequireFixture("cardMultiEditors")[0]
            .getSnapshot()
            .json.content!.find((n) => n.type === "semloEditorCalendar")!.attrs!.events[0],
      );
      expect(event).toMatchObject({ start: "2026-11-09", end: "2026-11-10", description: "进一步说明", color: 6 });
    } else await expect(panel).toHaveCount(0);
  });
}

test("candidate calendar keeps composition draft while host normalizes", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "日程：甲日程" }).first().click();
  const title = page.getByRole("dialog", { name: "编辑日程" }).getByLabel("日程标题");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
    let done = false;
    editor.on("update", () => {
      if (done) return;
      done = true;
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "semloEditorCalendar") pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      const events = node.attrs.events.map((event: Record<string, unknown>) => ({ ...event, title: "规范后" }));
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, events }));
    });
  });
  await title.evaluate((el: HTMLTextAreaElement) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.value = "拼音";
    el.setSelectionRange(1, 1);
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: "音", inputType: "insertCompositionText", isComposing: true }),
    );
  });
  await expect(title).toHaveValue("拼音");
  expect(await title.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(1);
  await title.evaluate((el: HTMLTextAreaElement) =>
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
  );
  await expect(title).toHaveValue("规范后");
});

for (const action of ["title", "range"] as const) {
  test(`candidate calendar tolerates destruction during ${action} commit`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
    await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "日程：甲日程" }).first().click();
    const panel = page.getByRole("dialog", { name: "编辑日程" });
    if (action === "range") {
      const start = panel.getByLabel("开始日期");
      await start.fill("2026-11-12");
      await start.press("Enter");
      await panel.getByLabel("结束日期").fill("2026-11-13");
    }
    await page.evaluate(() => {
      const c = window.__semloRequireFixture("cardMultiEditors")[0];
      c.editor.on("update", () => c.destroy());
    });
    if (action === "title") await panel.getByLabel("日程标题").fill("修改");
    else await panel.getByLabel("结束日期").press("Enter");
    await expect(panel).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("probe calendar host update exception remains observable and later edits still work", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "日程：甲日程" }).first().click();
  const panel = page.getByRole("dialog", { name: "编辑日程" });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
    let done = false;
    editor.on("update", () => {
      if (!done) {
        done = true;
        throw new Error("宿主更新失败");
      }
    });
  });
  await panel.getByLabel("日程标题").fill("第一次");
  await expect.poll(() => errors).toContain("宿主更新失败");
  await panel.getByLabel("日程标题").fill("第二次");
  const value = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("cardMultiEditors")[0]
        .getSnapshot()
        .json.content!.find((n) => n.type === "semloEditorCalendar")!.attrs!.events[0].title,
  );
  expect(value).toBe("第二次");
});

test("probe calendar normalized update followed by host exception preserves host value", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.goto(origin);
  await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
  await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "日程：甲日程" }).first().click();
  const panel = page.getByRole("dialog", { name: "编辑日程" });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
    let done = false;
    const originalError = new Error("宿主规范后失败");
    window.addEventListener(
      "error",
      (event) => Reflect.set(window, "calendarErrorIdentity", event.error === originalError),
      { once: true },
    );
    editor.on("update", () => {
      if (done) return;
      done = true;
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "semloEditorCalendar") pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      const events = node.attrs.events.map((event: Record<string, unknown>) => ({ ...event, title: "规范后" }));
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, events }));
      throw originalError;
    });
  });
  await panel.getByLabel("日程标题").fill("进行中");
  await expect.poll(() => errors).toContain("宿主规范后失败");
  expect(await page.evaluate(() => Reflect.get(window, "calendarErrorIdentity"))).toBe(true);
  await panel.getByLabel("日程说明").fill("补充说明");
  const title = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("cardMultiEditors")[0]
        .getSnapshot()
        .json.content!.find((n) => n.type === "semloEditorCalendar")!.attrs!.events[0].title,
  );
  expect(title).toBe("规范后");
});

for (const reportMode of ["native", "missing", "throws"] as const)
  test(`candidate calendar surfaces reconciliation failure with ${reportMode} reporter`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => window.cardMultiEditors?.length === 2);
    await page.locator('[data-editor-name="甲"]').getByRole("button", { name: "日程：甲日程" }).first().click();
    const panel = page.getByRole("dialog", { name: "编辑日程" });
    await page.evaluate((reportMode) => {
      const editor = window.__semloRequireFixture("cardMultiEditors")[0].editor;
      const title = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="日程标题"]')!;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!;
      const original = new Error("原始宿主异常");
      const secondary = new Error("草稿同步异常");
      const reportFailure = new Error("异常报告器失败");
      const seen: string[] = [];
      if (reportMode === "missing")
        Object.defineProperty(window, "reportError", { configurable: true, value: undefined });
      if (reportMode === "throws")
        Object.defineProperty(window, "reportError", {
          configurable: true,
          value: () => {
            throw reportFailure;
          },
        });
      Reflect.set(window, "calendarErrorOrder", seen);
      window.addEventListener("error", (event) => {
        if (event.error === original) seen.push("original");
        if (event.error === secondary) seen.push("secondary");
        if (
          event.error instanceof AggregateError &&
          event.error.cause === secondary &&
          event.error.errors.includes(reportFailure)
        )
          seen.push("aggregate");
      });
      Object.defineProperty(title, "value", {
        configurable: true,
        get() {
          return descriptor.get!.call(this);
        },
        set(value) {
          if (value === "规范后") throw secondary;
          descriptor.set!.call(this, value);
        },
      });
      let done = false;
      editor.on("update", () => {
        if (done) return;
        done = true;
        let pos = -1;
        editor.state.doc.descendants((node, at) => {
          if (node.type.name === "semloEditorCalendar") pos = at;
        });
        const node = editor.state.doc.nodeAt(pos)!;
        const events = node.attrs.events.map((event: Record<string, unknown>) => ({ ...event, title: "规范后" }));
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, events }));
        throw original;
      });
    }, reportMode);
    await panel.getByLabel("日程标题").fill("进行中");
    await expect.poll(() => errors).toContain("原始宿主异常");
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "calendarErrorOrder").length)).toBe(2);
    const seen = await page.evaluate(() => Reflect.get(window, "calendarErrorOrder") as string[]);
    expect(seen).toContain("original");
    expect(seen).toContain(reportMode === "throws" ? "aggregate" : "secondary");
  });
