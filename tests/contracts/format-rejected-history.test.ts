import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../fixtures/browser/fixture-rsbuild";
import type {} from "../fixtures/format/format-rejected-history-fixture";
let origin = "",
  stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/format/format-rejected-history-fixture.ts"));
});
afterAll(async () => {
  await stop?.();
});
test.beforeEach(async ({ page }) => installFixtureGuards(page));
async function run(
  page: Page,
  command: "bold" | "size",
  order: "early" | "late",
  attempt: boolean,
  mode: "reject" | "allow" | "reenter" | "append" | "readonly" = "reject",
) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountFormatRejectedHistory === "function");
  await page.evaluate((value) => window.__semloRequireFixture("mountFormatRejectedHistory")(value), order);
  await page.evaluate(() => {
    const e = window.__semloRequireFixture("formatRejectedHistory").controller.editor;
    e.commands.setTextSelection(3);
    e.view.focus();
  });
  await page.keyboard.type("A");
  const before = await page.evaluate((nextMode) => {
    const f = window.__semloRequireFixture("formatRejectedHistory"),
      e = f.controller.editor,
      s = e.state,
      first = s.doc.firstChild!,
      heading = s.doc.child(1),
      cursor = s.selection.anchor;
    const end = first.nodeSize + 1 + heading.content.size;
    e.commands.setTextSelection({ from: 1, to: end });
    f.arm(nextMode);
    return { cursor, json: e.getJSON(), depth: f.undoDepth(), pluginOrder: f.pluginOrder() };
  }, mode);
  if (attempt) await page.keyboard.press(command === "bold" ? "ControlOrMeta+b" : "ControlOrMeta+Alt+=");
  else if (mode === "reenter")
    await page.evaluate(() => window.__semloRequireFixture("formatRejectedHistory").reenter());
  const afterShortcut = await page.evaluate(() => {
    const f = window.__semloRequireFixture("formatRejectedHistory");
    return {
      json: f.controller.editor.getJSON(),
      events: f.events.map((event) => ({ trusted: event.isTrusted, prevented: event.defaultPrevented })),
      trace: [...f.trace],
      depth: f.undoDepth(),
      appended: f.appendCount(),
      editable: f.controller.editor.view.editable,
    };
  });
  if (mode === "readonly")
    await page.evaluate(() => {
      const f = window.__semloRequireFixture("formatRejectedHistory");
      f.enableEditing();
      f.controller.editor.view.focus();
    });
  await page.evaluate(
    (cursor) =>
      window.__semloRequireFixture("formatRejectedHistory").controller.editor.commands.setTextSelection(cursor),
    before.cursor,
  );
  await page.keyboard.type("B");
  const afterTyping = await page.evaluate(() => {
    const f = window.__semloRequireFixture("formatRejectedHistory");
    return { json: f.controller.editor.getJSON(), depth: f.undoDepth() };
  });
  await page.keyboard.press("ControlOrMeta+z");
  const afterUndo = await page.evaluate(() => {
    const f = window.__semloRequireFixture("formatRejectedHistory");
    return { json: f.controller.editor.getJSON(), depth: f.undoDepth() };
  });
  return { before, afterShortcut, afterTyping, afterUndo };
}
for (const command of ["bold", "size"] as const)
  for (const order of ["early", "late"] as const) {
    test(`${command} ${order} reject preserves typing undo grouping`, async ({ page }) => {
      const control = await run(page, command, order, false),
        attempt = await run(page, command, order, true);

      expect(attempt.before.pluginOrder.host).toBeGreaterThanOrEqual(0);
      expect(attempt.before.pluginOrder.history).toBeGreaterThanOrEqual(0);
      expect(attempt.before.pluginOrder.host < attempt.before.pluginOrder.history).toBe(order === "early");
      expect(control.afterTyping.json.content?.[0]?.content?.[0]).toMatchObject({ text: "abABc" });
      expect(control.afterUndo.json.content?.[0]?.content?.[0]).toMatchObject({ text: "abc" });
      expect(attempt.afterShortcut.events).toEqual([{ trusted: true, prevented: true }]);
      expect(attempt.afterShortcut.trace.filter((item) => item.rejected)).toHaveLength(1);
      expect(attempt.afterShortcut.json).toEqual(attempt.before.json);
      expect(attempt.afterTyping.json).toEqual(control.afterTyping.json);
      expect(attempt.afterUndo.json).toEqual(control.afterUndo.json);
      expect(attempt.afterUndo.depth).toEqual(control.afterUndo.depth);
    });

    test(`${command} ${order} rejects uncommitted reentry without changing typing undo grouping`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const control = await run(page, command, order, false, "reenter"),
        attempt = await run(page, command, order, true, "reenter");

      expect(control.afterUndo.json.content?.[0]?.content?.[0]).toMatchObject({ text: "abc" });
      expect(errors).toEqual(["A transaction cannot be dispatched before the current transaction commits"]);
      expect(attempt.afterShortcut.events).toEqual([{ trusted: true, prevented: true }]);
      expect(attempt.afterShortcut.trace.filter((item) => item.rejected)).toHaveLength(1);
      expect(attempt.afterShortcut.trace.filter((item) => item.reentry)).toHaveLength(0);
      expect(attempt.afterShortcut.json).toEqual(attempt.before.json);
      expect(attempt.afterTyping.json).toEqual(control.afterTyping.json);
      expect(attempt.afterUndo.json).toEqual(control.afterUndo.json);
      expect(attempt.afterUndo.depth).toEqual(control.afterUndo.depth);
    });

    for (const mode of ["allow", "append", "readonly"] as const)
      test(`${command} ${order} ${mode} accepted formatting remains a separate undo event`, async ({ page }) => {
        const attempt = await run(page, command, order, true, mode);

        expect(attempt.afterShortcut.events).toEqual([{ trusted: true, prevented: true }]);
        expect(attempt.afterShortcut.trace.filter((item) => item.docChanged)).toHaveLength(1);
        expect(attempt.afterShortcut.appended).toBe(mode === "append" ? 1 : 0);
        expect(attempt.afterShortcut.editable).toBe(mode !== "readonly");
        expect(attempt.afterShortcut.json.content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe(
          command === "bold" ? "bold" : "textStyle",
        );
        expect(attempt.afterShortcut.json.content?.[1]).toEqual(attempt.before.json.content?.[1]);
        expect(attempt.afterUndo.json).toEqual(attempt.afterShortcut.json);
        await page.keyboard.press("ControlOrMeta+z");
        const undoFormatting = await page.evaluate(() =>
          window.__semloRequireFixture("formatRejectedHistory").controller.editor.getJSON(),
        );
        expect(undoFormatting).toEqual(attempt.before.json);
        await page.keyboard.press("ControlOrMeta+z");
        const undoTyping = await page.evaluate(() =>
          window.__semloRequireFixture("formatRejectedHistory").controller.editor.getJSON(),
        );
        expect(undoTyping.content?.[0]?.content?.[0]).toMatchObject({ text: "abc" });
      });
  }

for (const command of ["bold", "size"] as const)
  for (const order of ["early", "late"] as const)
    for (const mode of ["throw-filter", "throw-append", "throw-before", "throw-after"] as const)
      test(`${command} ${order} preserves ${mode} and cleans temporary listeners`, async ({ page }) => {
        await page.goto(origin);
        await page.waitForFunction(() => typeof window.mountFormatRejectedHistory === "function");
        await page.evaluate((value) => window.__semloRequireFixture("mountFormatRejectedHistory")(value), order);
        const result = await page.evaluate(
          ({ command: selectedCommand, mode: selectedMode }) => {
            const f = window.__semloRequireFixture("formatRejectedHistory"),
              e = f.controller.editor,
              first = e.state.doc.firstChild!,
              heading = e.state.doc.child(1);
            e.commands.setTextSelection({ from: 1, to: first.nodeSize + 1 + heading.content.size });
            e.view.focus();
            f.arm(selectedMode);
            const before = e.getJSON();
            f.beginListenerAudit();
            let error = "";
            try {
              f.invoke(selectedCommand);
            } catch (value) {
              error = value instanceof Error ? value.message : String(value);
            }
            const after = e.getJSON(),
              listenerAudit = f.endListenerAudit();
            f.disarm();
            e.commands.setTextSelection(2);
            e.commands.insertContent("X");
            return {
              before,
              after,
              listenerAudit,
              error,
              text: e.state.doc.textBetween(0, e.state.doc.content.size, "|"),
            };
          },
          { command, mode },
        );

        expect(result.error).toBe(`host ${mode.replace("throw-", "").replace("after", "transaction")} error`);
        expect(result.listenerAudit.remaining).toBe(0);
        if (mode === "throw-after") {
          expect(result.after.content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe(
            command === "bold" ? "bold" : "textStyle",
          );
          expect(result.after.content?.[1]).toEqual(result.before.content?.[1]);
        } else expect(result.after).toEqual(result.before);
        expect(result.text).toBe("aXbc|head|tail");
      });

for (const command of ["bold", "size"] as const)
  for (const order of ["early", "late"] as const)
    for (const mode of ["destroy-accept", "destroy-reject"] as const)
      test(`${command} ${order} ${mode} does not dispatch to a destroyed view`, async ({ page }) => {
        await page.goto(origin);
        await page.waitForFunction(() => typeof window.mountFormatRejectedHistory === "function");
        await page.evaluate((value) => window.__semloRequireFixture("mountFormatRejectedHistory")(value), order);
        const result = await page.evaluate(
          ({ command: selectedCommand, mode: selectedMode }) => {
            const f = window.__semloRequireFixture("formatRejectedHistory"),
              e = f.controller.editor,
              view = e.view,
              first = e.state.doc.firstChild!,
              heading = e.state.doc.child(1);
            e.commands.setTextSelection({ from: 1, to: first.nodeSize + 1 + heading.content.size });
            view.focus();
            let dispatchAfterDestroy = 0;
            const dispatch = view.dispatch.bind(view);
            view.dispatch = (transaction) => {
              if (view.isDestroyed) dispatchAfterDestroy++;
              return dispatch(transaction);
            };
            f.arm(selectedMode);
            f.beginListenerAudit();
            let error = "";
            try {
              f.invoke(selectedCommand);
            } catch (value) {
              error = value instanceof Error ? value.message : String(value);
            }
            const listenerAudit = f.endListenerAudit();
            return {
              error,
              destroyed: view.isDestroyed,
              dispatchAfterDestroy,
              listenerAudit,
              json: view.state.doc.toJSON(),
              trace: [...f.trace],
            };
          },
          { command, mode },
        );

        expect(result.error).toBe("");
        expect(result.destroyed).toBe(true);
        expect(result.listenerAudit.remaining).toBe(0);
        expect(result.dispatchAfterDestroy).toBe(0);
        expect(result.json.content[0].content[0].text).toBe("abc");
        expect(result.json.content[1].content[0].text).toBe("head");
        expect(result.json.content[0].content[0].marks?.[0]?.type).toBe(
          mode === "destroy-accept" ? (command === "bold" ? "bold" : "textStyle") : undefined,
        );
      });
