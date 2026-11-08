import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../fixtures/browser/fixture-rsbuild";
import type {} from "../fixtures/heading/heading-delete-controlled-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-delete-controlled-fixture.ts", {
    framework: true,
  }));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

test("react: controlled content settles after a delayed React commit", async ({ page }) => {
  await page.addInitScript(() => {
    const gate = {
      hold: false,
      jobs: [] as Array<() => void>,
      settled: false,
      waiting: undefined as Promise<void> | undefined,
    };
    Reflect.set(window, "__semloReactSchedulerGate", gate);
    const NativeMessageChannel = window.MessageChannel;
    window.MessageChannel = class extends NativeMessageChannel {
      constructor() {
        super();
        const port = this.port2;
        const send = port.postMessage;
        port.postMessage = ((...args: Parameters<MessagePort["postMessage"]>) => {
          const post = () => Reflect.apply(send, port, args);
          if (gate.hold) gate.jobs.push(post);
          else post();
        }) as MessagePort["postMessage"];
      }
    };
  });
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
  await page.evaluate(async () => {
    await window.__semloRequireFixture("mountRestartControlledFixture")("react", "legacy");
    await window.__semloRequireFixture("restartControlledFixture").settle();
  });
  const beforeRelease = await page.evaluate(async () => {
    const fixture = window.__semloRequireFixture("restartControlledFixture");
    const gate = Reflect.get(window, "__semloReactSchedulerGate") as {
      hold: boolean;
      jobs: Array<() => void>;
      settled: boolean;
      waiting: Promise<void>;
    };
    gate.hold = true;
    fixture.setContent("<p>正文</p><h3>标题</h3><p>后文</p>");
    gate.waiting = fixture.settle();
    void gate.waiting.then(() => {
      gate.settled = true;
    });
    await new Promise<void>((resolve) => {
      let frames = 0;
      const frame = () => (++frames === 5 ? resolve() : requestAnimationFrame(frame));
      requestAnimationFrame(frame);
    });
    return { queued: gate.jobs.length, settled: gate.settled, text: fixture.controller.editor.state.doc.textContent };
  });
  expect(beforeRelease.queued).toBeGreaterThan(0);
  expect(beforeRelease.text).not.toBe("正文标题后文");
  expect(beforeRelease.settled).toBe(false);

  const afterRelease = await page.evaluate(async () => {
    const fixture = window.__semloRequireFixture("restartControlledFixture");
    const gate = Reflect.get(window, "__semloReactSchedulerGate") as {
      hold: boolean;
      jobs: Array<() => void>;
      waiting: Promise<void>;
    };
    gate.hold = false;
    for (const run of gate.jobs.splice(0)) run();
    await gate.waiting;
    const editor = fixture.controller.editor;
    const first = editor.state.doc.firstChild!;
    const heading = editor.state.doc.child(1);
    editor.view.focus();
    editor.commands.setTextSelection({ from: 1, to: first.nodeSize + 1 + heading.content.size });
    return editor.state.doc.textContent;
  });
  expect(afterRelease).toBe("正文标题后文");
  await page.keyboard.press("ControlOrMeta+b");
  const result = await page.evaluate(async () => {
    const fixture = window.__semloRequireFixture("restartControlledFixture");
    await fixture.settle();
    return { changes: fixture.changes.length, json: fixture.controller.getSnapshot().json };
  });
  expect(result.changes).toBe(1);
  expect(result.json.content?.[0]?.content?.[0]?.marks?.some((mark) => mark.type === "bold")).toBe(true);
});

for (const framework of ["core", "react", "vue", "solid"] as const)
  for (const command of ["bold", "size"] as const)
    test(`${framework}: mixed ${command} survives controlled feedback and undo/redo`, async ({ page }) => {
      await page.goto(origin);
      await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
      await page.evaluate(
        (value) => window.__semloRequireFixture("mountRestartControlledFixture")(value, "legacy"),
        framework,
      );
      await page.evaluate(async () => {
        const fixture = window.__semloRequireFixture("restartControlledFixture");
        fixture.setContent("<p>正文</p><h3>标题</h3><p>后文</p>");
        await fixture.settle();
        const editor = fixture.controller.editor,
          first = editor.state.doc.firstChild!,
          heading = editor.state.doc.child(1);
        editor.view.focus();
        editor.commands.setTextSelection({ from: 1, to: first.nodeSize + 1 + heading.content.size });
      });
      const before = await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("restartControlledFixture");
        return { json: fixture.controller.getSnapshot().json, changes: fixture.changes.length };
      });
      await page.keyboard.press(command === "bold" ? "ControlOrMeta+b" : "ControlOrMeta+Alt+=");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const after = await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("restartControlledFixture");
        return { json: fixture.controller.getSnapshot().json, changes: fixture.changes.length, errors: fixture.errors };
      });
      expect(after.errors).toEqual([]);
      expect(after.changes).toBe(before.changes + 1);
      expect(after.json.content?.[1]).toEqual(before.json.content?.[1]);
      expect(after.json.content?.[2]).toEqual(before.json.content?.[2]);
      const marks = after.json.content?.[0]?.content?.[0]?.marks ?? [];
      expect(marks.some((mark) => mark.type === (command === "bold" ? "bold" : "textStyle"))).toBe(true);
      if (command === "size") expect(marks.find((mark) => mark.type === "textStyle")?.attrs?.fontSize).toBe("16px");
      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      expect(
        await page.evaluate(
          () => window.__semloRequireFixture("restartControlledFixture").controller.getSnapshot().json,
        ),
      ).toEqual(before.json);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      expect(
        await page.evaluate(
          () => window.__semloRequireFixture("restartControlledFixture").controller.getSnapshot().json,
        ),
      ).toEqual(after.json);
    });

for (const command of ["bold", "size"] as const)
  test(`table cell selection keeps ${command} and undo/redo semantics`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
    await page.evaluate(() => window.__semloRequireFixture("mountRestartControlledFixture")("core", "legacy"));
    const before = await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("restartControlledFixture");
      fixture.setContent(
        "<table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td><td><p>丙</p></td></tr></tbody></table>",
      );
      await fixture.settle();
      const editor = fixture.controller.editor,
        cells: number[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === "tableCell") cells.push(position);
      });
      editor.view.focus();
      editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
      return { json: fixture.controller.getSnapshot().json, selection: editor.state.selection.constructor.name };
    });
    expect(before.selection).toBe("CellSelection");
    await page.keyboard.press(command === "bold" ? "ControlOrMeta+b" : "ControlOrMeta+Alt+=");
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    const after = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("restartControlledFixture"),
        editor = fixture.controller.editor,
        texts: Array<{ text: string; marks: string[]; size: string | null }> = [];
      editor.state.doc.descendants((node) => {
        if (node.isText)
          texts.push({
            text: node.text ?? "",
            marks: node.marks.map((mark) => mark.type.name),
            size: node.marks.find((mark) => mark.type.name === "textStyle")?.attrs.fontSize ?? null,
          });
      });
      return { json: fixture.controller.getSnapshot().json, selection: editor.state.selection.constructor.name, texts };
    });
    expect(after.selection).toBe("CellSelection");
    expect(after.texts.map((item) => item.text)).toEqual(["甲", "乙", "丙"]);
    for (const cell of after.texts.slice(0, 2)) {
      expect(cell.marks).toContain(command === "bold" ? "bold" : "textStyle");
      if (command === "size") expect(cell.size).toBe("16px");
    }
    expect(after.texts[2].marks).toEqual([]);
    await page.keyboard.press("ControlOrMeta+z");
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    expect(
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").controller.getSnapshot().json),
    ).toEqual(before.json);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    expect(
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").controller.getSnapshot().json),
    ).toEqual(after.json);
  });
