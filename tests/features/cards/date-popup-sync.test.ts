import { afterAll, beforeAll, expect, test } from "@rstest/playwright";
import type { Transaction } from "@tiptap/pm/state";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    datePopupSyncEditor?: EditorController;
    closeDatePopupHistory?: (transaction: Transaction) => Transaction;
  }
}

let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/calendar/date-popup-sync-fixture.ts"));
});
afterAll(async () => closeServer?.());

test("an open date picker follows document changes and keeps date and time through history and serialization", async ({
  page,
}) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  const button = page.locator(".semlo-editor-date-node button");
  await button.click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await picker.getByRole("checkbox", { name: "时刻" }).check();
  await picker.getByRole("checkbox", { name: "时刻" }).press("Escape");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "选择时刻" }).click();
  await picker.getByRole("button", { name: "选择时刻" }).press("Escape");
  await expect(picker.getByRole("listbox", { name: "选择时刻" })).toBeVisible();
  await picker.getByRole("option", { name: "12:30", exact: true }).click();
  await expect(button).toHaveAttribute("aria-label", "日期：2026-11-03 12:30");
  await picker.getByRole("checkbox", { name: "时刻" }).uncheck();
  await expect(button).toHaveAttribute("aria-label", "日期：2026-11-03");
  await picker.getByRole("checkbox", { name: "时刻" }).check();
  await expect(picker.getByRole("button", { name: "选择时刻" })).toHaveText("12:30");

  await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("datePopupSyncEditor");
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "semloEditorDate") pos = at;
    });
    const node = editor.state.doc.nodeAt(pos)!;
    editor.view.dispatch(
      window
        .__semloRequireFixture("closeDatePopupHistory")
        .bind(window)(editor.state.tr)
        .setNodeMarkup(pos, undefined, { ...node.attrs, date: "2027-02-04", time: "09:15" }),
    );
  });
  await expect(picker.getByRole("button", { name: "选择年份" })).toHaveText("2027年");
  await expect(picker.getByRole("button", { name: "选择月份" })).toHaveText("2月");
  await expect(picker.getByRole("button", { name: "选择时刻" })).toHaveText("09:15");
  await page.evaluate(() => window.__semloRequireFixture("datePopupSyncEditor").editor.commands.undo());
  await expect(button).toHaveAttribute("aria-label", "日期：2026-11-03 12:30");
  await expect(picker.getByRole("button", { name: "选择时刻" })).toHaveText("12:30");
  await page.evaluate(() => window.__semloRequireFixture("datePopupSyncEditor").editor.commands.redo());
  await expect(picker.getByRole("button", { name: "选择时刻" })).toHaveText("09:15");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("datePopupSyncEditor").getSnapshot());
  for (const content of [snapshot.json, snapshot.html]) {
    const result = await page.evaluate((value) => {
      const editor = window.__semloRequireFixture("datePopupSyncEditor");
      editor.setContent(value);
      return editor.getSnapshot().json;
    }, content);
    expect(result).toEqual(snapshot.json);
  }
});

test("date picker closes on an outside click and when editing is disabled", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  const button = page.locator(".semlo-editor-date-node button");
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await button.click();
  await expect(picker).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(picker).toHaveCount(0);
  await button.click();
  await expect(picker).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("datePopupSyncEditor").setEditable(false));
  await expect(picker).toHaveCount(0);
});

test("Tab from an enabled time checkbox closes the date picker without changing its value", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  const button = page.locator(".semlo-editor-date-node button");
  await button.click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await picker.getByRole("checkbox", { name: "时刻" }).check();
  const checked = picker.getByRole("checkbox", { name: "时刻" });
  await expect(checked).toBeFocused();
  const before = await button.getAttribute("aria-label");
  await page.keyboard.press("Tab");
  await expect(picker).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-label", before!);
  await expect(page.locator(".ProseMirror")).toBeFocused();
});

test("Shift+Tab from the time checkbox focuses the previous quick date button", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.locator(".semlo-editor-date-node button").click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await picker.getByRole("checkbox", { name: "时刻" }).check();
  await expect(picker.getByRole("checkbox", { name: "时刻" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(picker.getByRole("button", { name: "+7天" })).toBeFocused();
  await expect(picker).toBeVisible();
});

test("opening the time list with a mouse keeps the editor focus and selected time", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("datePopupSyncEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { date: "2026-11-03", time: "12:00" } }] },
      ],
    }),
  );
  await page.locator(".ProseMirror").focus();
  await page.locator(".semlo-editor-date-node button").click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  const trigger = picker.getByRole("button", { name: "选择时刻" });
  const before = await trigger.textContent();
  await trigger.click();
  await expect(page.locator(".ProseMirror")).toBeFocused();
  await expect(picker.getByRole("listbox", { name: "选择时刻" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(trigger).toHaveText(before!);
  await expect(picker.getByRole("option", { name: before!, exact: true })).toHaveAttribute("aria-selected", "true");
});

test("the time list still supports keyboard navigation when its trigger is focused", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T11:24:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  const date = page.locator(".semlo-editor-date-node button");
  await date.click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await picker.getByRole("checkbox", { name: "时刻" }).check();
  const trigger = picker.getByRole("button", { name: "选择时刻" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(picker.getByRole("option", { name: "11:30", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(picker.getByRole("option", { name: "11:45", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03 11:45");
});

test("opening a date card with a mouse keeps the editor focused", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  const editor = page.locator(".ProseMirror");
  await editor.focus();
  await page.locator(".semlo-editor-date-node button").click();
  await expect(page.getByRole("dialog", { name: "选择日期" })).toBeVisible();
  await expect(editor).toBeFocused();
});

test("explicit replacement of an equal date node closes the old picker", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  const button = page.locator(".semlo-editor-date-node button");
  await button.click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await expect(picker).toBeVisible();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorDate") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const replacement = editor.schema.nodeFromJSON(node.toJSON());
    editor.view.dispatch(editor.state.tr.replaceWith(position, position + node.nodeSize, replacement));
  });
  await expect(picker).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-label", "日期：2026-11-03");
});

test("ordinary adjacent text edits and equal host echoes preserve the date picker", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.locator(".semlo-editor-date-node button").click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("datePopupSyncEditor");
    controller.setContent(controller.getSnapshot().json);
    controller.editor.view.dispatch(controller.editor.state.tr.insertText("前文", 1));
  });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "2026-11-05", exact: true }).click();
  await expect(page.locator(".semlo-editor-date-node button")).toHaveAttribute("aria-label", "日期：2026-11-05");
  await expect(page.locator(".ProseMirror")).toContainText("前文");
});

test("a synchronous nested transaction cannot keep a replaced date node's old picker", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.locator(".semlo-editor-date-node button").click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorDate") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const replacement = editor.schema.nodeFromJSON(node.toJSON());
    editor.view.dispatch(
      editor.state.tr.replaceWith(position, position + node.nodeSize, replacement).setMeta("date-reentry-test", true),
    );
  });
  expect(await page.evaluate(() => Reflect.get(window, "dateNestedTransactions"))).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, "datePopupDuringReentry"))).toBe(true);
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".semlo-editor-date-node button")).toHaveAttribute("aria-label", "日期：2026-11-03");
});

test("a date node with a different explicit id closes the old picker", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("datePopupSyncEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { id: "original", date: "2026-11-03" } }] },
      ],
    }),
  );
  await page.locator(".semlo-editor-date-node button").click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await expect(picker).toBeVisible();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorDate") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, id: "replacement", date: "2027-02-04" }),
    );
  });
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".semlo-editor-date-node button")).toHaveAttribute("aria-label", "日期：2027-02-04");
});

test("an update to the same explicit date id keeps the picker synchronized", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("datePopupSyncEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { id: "original", date: "2026-11-03" } }] },
      ],
    }),
  );
  await page.locator(".semlo-editor-date-node button").click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorDate") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, date: "2027-02-04" }));
  });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button", { name: "选择年份" })).toHaveText("2027年");
  await expect(picker.getByRole("button", { name: "选择月份" })).toHaveText("2月");
});

test("rebuilding one duplicate-id date does not close another date's picker", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  const sharedReference = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    const date = editor.schema.nodes.semloEditorDate.create({ id: "same", date: "2026-11-03" });
    const paragraph = editor.schema.nodes.paragraph.create(null, [date, editor.schema.text("间隔"), date]);
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, paragraph));
    const nodes: unknown[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "semloEditorDate") nodes.push(node);
    });
    return nodes.length === 2 && nodes[0] === nodes[1];
  });
  expect(sharedReference).toBe(true);
  const dates = page.locator(".semlo-editor-date-node button");
  await dates.first().click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  const replace = async (index: number) =>
    page.evaluate((target) => {
      const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
      const positions: number[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "semloEditorDate") positions.push(pos);
      });
      const position = positions[target];
      const node = editor.state.doc.nodeAt(position)!;
      editor.view.dispatch(
        editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
      );
    }, index);
  await replace(1);
  await expect(picker).toBeVisible();
  await replace(0);
  await expect(picker).toHaveCount(0);
  await expect(dates).toHaveCount(2);
});

test("moving a date node cannot make its picker edit the old position", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("datePopupSyncEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { id: "moving", date: "2026-11-03" } }] },
        { type: "paragraph", content: [{ type: "text", text: "后文" }] },
      ],
    }),
  );
  await page.locator(".semlo-editor-date-node button").click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorDate") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const transaction = editor.state.tr.delete(position, position + node.nodeSize);
    transaction.insert(transaction.doc.content.size - 1, node);
    editor.view.dispatch(transaction);
  });
  if (!(await picker.isVisible())) await page.locator(".semlo-editor-date-node button").click();
  await picker.getByRole("button", { name: "2026-11-05", exact: true }).click();
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("datePopupSyncEditor").getSnapshot().json);
  expect(snapshot.content?.[0].type).toBe("paragraph");
  expect(snapshot.content?.[0].content ?? []).toEqual([]);
  expect(snapshot.content?.[1].content?.[0].text).toBe("后文");
  expect(snapshot.content?.[1].content?.[1].attrs?.id).toBe("moving");
  expect(snapshot.content?.[1].content?.[1].attrs?.date).toBe("2026-11-05");
});

test("a date picker action reentered before node replacement cannot edit the replacement", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("datePopupSyncEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { id: "original", date: "2026-11-03" } }] },
      ],
    }),
  );
  await page.locator(".semlo-editor-date-node button").click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await expect(picker.getByRole("button", { name: "2026-11-05", exact: true })).toBeVisible();
  const invoked = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    let count = 0;
    const handler = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.getMeta("date-before-replacement-test")) return;
      count += 1;
      document
        .querySelector<HTMLButtonElement>('[role="dialog"][aria-label="选择日期"] button[aria-label="2026-11-05"]')!
        .click();
    };
    editor.on("beforeTransaction", handler);
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorDate") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const replacement = editor.schema.nodes.semloEditorDate.create({ id: "replacement", date: "2027-02-04" });
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(position, position + node.nodeSize, replacement)
        .setMeta("date-before-replacement-test", true),
    );
    editor.off("beforeTransaction", handler);
    return count;
  });
  expect(invoked).toBe(1);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("datePopupSyncEditor").getSnapshot().json);
  expect(snapshot.content?.[0].content?.[0].attrs?.id).toBe("replacement");
  expect(snapshot.content?.[0].content?.[0].attrs?.date).toBe("2027-02-04");
  await expect(picker).toHaveCount(0);
});

test("beforeTransaction replacement should not emit a stale date edit", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.name));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.evaluate(() =>
    window.__semloRequireFixture("datePopupSyncEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { id: "original", date: "2026-11-03" } }] },
      ],
    }),
  );
  await page.locator(".semlo-editor-date-node button").click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await expect(picker.getByRole("button", { name: "2026-11-05", exact: true })).toBeVisible();
  const invoked = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    Reflect.set(window, "dateObservedChanges", []);
    let count = 0;
    const handler = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.getMeta("date-before-replacement-test")) return;
      count += 1;
      document
        .querySelector<HTMLButtonElement>('[role="dialog"][aria-label="选择日期"] button[aria-label="2026-11-05"]')!
        .click();
    };
    editor.on("beforeTransaction", handler);
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorDate") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const replacement = editor.schema.nodes.semloEditorDate.create({ id: "replacement", date: "2027-02-04" });
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(position, position + node.nodeSize, replacement)
        .setMeta("date-before-replacement-test", true),
    );
    editor.off("beforeTransaction", handler);
    return {
      count,
      changes: Reflect.get(window, "dateObservedChanges") as Array<{
        content: Array<{ content: Array<{ attrs: { id: string; date: string } }> }>;
      }>,
    };
  });
  expect(invoked.count).toBe(1);
  expect(pageErrors).toContain("ReentrantTransactionError");
  expect(invoked.changes.map((json) => json.content[0].content[0].attrs)).toEqual([
    expect.objectContaining({ id: "replacement", date: "2027-02-04" }),
  ]);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("datePopupSyncEditor").getSnapshot().json);
  expect(snapshot.content?.[0].content?.[0].attrs?.id).toBe("replacement");
  expect(snapshot.content?.[0].content?.[0].attrs?.date).toBe("2027-02-04");
  await expect(picker).toHaveCount(0);
});

for (const action of ["date", "time-toggle", "time-option"] as const) {
  test(`synchronous host destruction during ${action} is safe`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
    if (action === "time-option") {
      await page.evaluate(() =>
        window.__semloRequireFixture("datePopupSyncEditor").setContent({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { date: "2026-11-03", time: "12:00" } }] },
          ],
        }),
      );
    }
    await page.locator(".semlo-editor-date-node button").click();
    const picker = page.getByRole("dialog", { name: "选择日期" });
    if (action === "time-option") await picker.getByRole("button", { name: "选择时刻" }).click();
    await page.evaluate(() => Reflect.set(window, "destroyDateEditorOnChange", true));
    if (action === "date") await picker.getByRole("button", { name: "2026-11-05", exact: true }).click();
    else if (action === "time-toggle") await picker.getByRole("checkbox", { name: "时刻" }).click();
    else await picker.getByRole("option", { name: "12:30", exact: true }).click();
    await expect(picker).toHaveCount(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("datePopupSyncEditor").editor.isDestroyed)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test("probe date picker reflects host time normalization during selection", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  const date = page.locator(".semlo-editor-date-node button");
  await date.click();
  const panel = page.getByRole("dialog", { name: "选择日期" });
  await panel.getByRole("checkbox", { name: "时刻" }).check();
  // 确保后续选择会改变时刻，不依赖打开弹层时的系统时间。
  await panel.getByRole("button", { name: "选择时刻" }).click();
  await panel.getByRole("option", { name: "12:00", exact: true }).click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    let done = false;
    editor.on("update", () => {
      if (done) return;
      done = true;
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "semloEditorDate") pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, time: "09:15" }));
    });
  });
  await panel.getByRole("button", { name: "选择时刻" }).click();
  await panel.getByRole("option", { name: "12:30", exact: true }).click();
  await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03 09:15");
  await expect(panel.getByRole("button", { name: "选择时刻" })).toHaveText("09:15");
});

for (const action of ["clear-time", "change-date", "replace-equal"] as const) {
  test(`probe date time selection with host ${action}`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
    const date = page.locator(".semlo-editor-date-node button");
    await date.click();
    const panel = page.getByRole("dialog", { name: "选择日期" });
    await panel.getByRole("checkbox", { name: "时刻" }).check();
    await panel.getByRole("button", { name: "选择时刻" }).click();
    await panel.getByRole("option", { name: "12:00", exact: true }).click();
    await page.evaluate((action) => {
      const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
      let done = false;
      editor.on("update", () => {
        if (done) return;
        done = true;
        let pos = -1;
        editor.state.doc.descendants((node, at) => {
          if (node.type.name === "semloEditorDate") pos = at;
        });
        const node = editor.state.doc.nodeAt(pos)!;
        const tr =
          action === "replace-equal"
            ? editor.state.tr.replaceWith(pos, pos + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON()))
            : editor.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                ...(action === "clear-time" ? { time: null } : { date: "2027-02-04" }),
              });
        editor.view.dispatch(tr);
      });
    }, action);
    await panel.getByRole("button", { name: "选择时刻" }).click();
    await panel.getByRole("option", { name: "12:30", exact: true }).click();
    if (action === "clear-time") {
      await expect(panel.getByRole("checkbox", { name: "时刻" })).not.toBeChecked();
      await expect(panel.getByRole("button", { name: "选择时刻" })).toHaveCount(0);
      await expect(date).toHaveAttribute("aria-label", "日期：2026-11-03");
    } else if (action === "change-date") {
      await expect(panel.getByRole("button", { name: "选择年份" })).toHaveText("2027年");
      await expect(panel.getByRole("button", { name: "选择月份" })).toHaveText("2月");
      await expect(panel.getByRole("button", { name: "选择时刻" })).toHaveText("12:30");
    } else await expect(panel).toHaveCount(0);
  });
}

test("probe date toggle reflects host normalized date", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.locator(".semlo-editor-date-node button").click();
  const panel = page.getByRole("dialog", { name: "选择日期" });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    let done = false;
    editor.on("update", () => {
      if (done) return;
      done = true;
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "semloEditorDate") pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, date: "2027-02-04" }));
    });
  });
  await panel.getByRole("checkbox", { name: "时刻" }).check();
  await expect(panel.getByRole("button", { name: "选择年份" })).toHaveText("2027年");
  await expect(panel.getByRole("button", { name: "选择月份" })).toHaveText("2月");
});

test("candidate selecting current date time does not emit a document update", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-03T11:24:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.locator(".semlo-editor-date-node button").click();
  const panel = page.getByRole("dialog", { name: "选择日期" });
  await panel.getByRole("checkbox", { name: "时刻" }).check();
  await page.evaluate(() => {
    Reflect.set(window, "dateNoopUpdates", 0);
    window
      .__semloRequireFixture("datePopupSyncEditor")
      .editor.on("update", () =>
        Reflect.set(window, "dateNoopUpdates", Number(Reflect.get(window, "dateNoopUpdates")) + 1),
      );
  });
  await panel.getByRole("button", { name: "选择时刻" }).click();
  await panel.getByRole("option", { name: "11:30", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, "dateNoopUpdates"))).toBe(0);
  await panel.getByRole("button", { name: "选择时刻" }).click();
  await panel.getByRole("option", { name: "12:30", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, "dateNoopUpdates"))).toBe(1);
});

test("probe date host normalizes then throws without losing normalized time", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-03T11:24:00"));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.locator(".semlo-editor-date-node button").click();
  const panel = page.getByRole("dialog", { name: "选择日期" });
  await panel.getByRole("checkbox", { name: "时刻" }).check();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    let done = false;
    const original = new Error("宿主日期更新失败");
    window.addEventListener("error", (event) => Reflect.set(window, "dateErrorIdentity", event.error === original), {
      once: true,
    });
    editor.on("update", () => {
      if (done) return;
      done = true;
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "semloEditorDate") pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, time: "09:15" }));
      throw original;
    });
  });
  await panel.getByRole("button", { name: "选择时刻" }).click();
  await panel.getByRole("option", { name: "12:30", exact: true }).click();
  await expect.poll(() => errors).toContain("宿主日期更新失败");
  expect(await page.evaluate(() => Reflect.get(window, "dateErrorIdentity"))).toBe(true);
  await panel.getByRole("checkbox", { name: "时刻" }).uncheck();
  await panel.getByRole("checkbox", { name: "时刻" }).check();
  await expect(panel.getByRole("button", { name: "选择时刻" })).toHaveText("09:15");
});

for (const reportMode of ["native", "missing", "throws"] as const) {
  test(`candidate date preserves host and refresh errors with ${reportMode} reporter`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-11-03T11:24:00"));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
    await page.locator(".semlo-editor-date-node button").click();
    const panel = page.getByRole("dialog", { name: "选择日期" });
    await panel.getByRole("checkbox", { name: "时刻" }).check();
    await panel.getByRole("button", { name: "选择时刻" }).click();
    await page.evaluate((reportMode) => {
      const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
      const panel = document.querySelector<HTMLElement>('[role="dialog"][aria-label="选择日期"]')!;
      const original = new Error("原始日期宿主异常");
      const secondary = new Error("日期面板同步异常");
      const reportFailure = new Error("日期异常报告器失败");
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
      Reflect.set(window, "dateErrorOrder", seen);
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
      panel.replaceChildren = () => {
        throw secondary;
      };
      let done = false;
      editor.on("update", () => {
        if (done) return;
        done = true;
        let pos = -1;
        editor.state.doc.descendants((node, at) => {
          if (node.type.name === "semloEditorDate") pos = at;
        });
        const node = editor.state.doc.nodeAt(pos)!;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, time: "09:15" }));
        throw original;
      });
    }, reportMode);
    await panel.getByRole("option", { name: "12:30", exact: true }).click();
    await expect.poll(() => errors).toContain("原始日期宿主异常");
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "dateErrorOrder").length)).toBe(2);
    const seen = await page.evaluate(() => Reflect.get(window, "dateErrorOrder") as string[]);
    expect(seen).toContain("original");
    expect(seen).toContain(reportMode === "throws" ? "aggregate" : "secondary");
  });
}

test("probe same-reference replacement closes the old date picker", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.locator(".semlo-editor-date-node button").click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  await expect(picker).toBeVisible();
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("datePopupSyncEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorDate") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const tr = editor.state.tr.replaceWith(position, position + node.nodeSize, node);
    const stepCount = tr.steps.length;
    editor.view.dispatch(tr);
    return { stepCount, sameNode: editor.state.doc.nodeAt(position) === node };
  });
  expect(result).toEqual({ stepCount: 1, sameNode: true });
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".semlo-editor-date-node button")).toHaveAttribute("aria-label", "日期：2026-11-03");
});

test("a rejected same-reference date replacement leaves the picker open", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.datePopupSyncEditor));
  await page.locator(".semlo-editor-date-node button").click();
  const picker = page.getByRole("dialog", { name: "选择日期" });
  const message = await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("datePopupSyncEditor");
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorDate") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const reject = () => {
      throw new Error("host rejected transaction");
    };
    editor.on("beforeTransaction", reject);
    let message = "";
    try {
      editor.view.dispatch(editor.state.tr.replaceWith(position, position + node.nodeSize, node));
    } catch (error) {
      message = (error as Error).message;
    } finally {
      editor.off("beforeTransaction", reject);
    }
    return message;
  });
  expect(message).toBe("host rejected transaction");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "2026-11-05", exact: true }).click();
  await expect(page.locator(".semlo-editor-date-node button")).toHaveAttribute("aria-label", "日期：2026-11-05");
});
