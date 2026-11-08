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
    statusSyncEditor?: EditorController;
    closeStatusHistory?: (transaction: Transaction) => Transaction;
  }
}
let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/cards/status-popup-sync-fixture.ts"));
});
afterAll(async () => closeServer?.());

test("status editor follows external updates, undo, redo and serialization", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  const status = page.getByRole("button", { name: "状态：待办" });
  await status.click();
  const dialog = page.getByRole("dialog", { name: "编辑状态" });
  await dialog.getByLabel("状态文字").fill("进行中");
  await dialog.getByRole("button", { name: "绿色" }).click();
  await page.evaluate(() => {
    const { editor } = window.__semloRequireFixture("statusSyncEditor");
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "semloEditorStatus") pos = at;
    });
    const node = editor.state.doc.nodeAt(pos)!;
    editor.view.dispatch(
      window
        .__semloRequireFixture("closeStatusHistory")
        .bind(window)(editor.state.tr)
        .setNodeMarkup(pos, undefined, { ...node.attrs, label: "完成", color: 4 }),
    );
  });
  await expect(dialog.getByLabel("状态文字")).toHaveValue("完成");
  await expect(dialog.getByRole("button", { name: "蓝色" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__semloRequireFixture("statusSyncEditor").editor.commands.undo())).toBe(true);
  await expect(dialog.getByLabel("状态文字")).toHaveValue("进行中");
  await expect(dialog.getByRole("button", { name: "绿色" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__semloRequireFixture("statusSyncEditor").editor.commands.redo())).toBe(true);
  await expect(dialog.getByLabel("状态文字")).toHaveValue("完成");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("statusSyncEditor").getSnapshot());
  for (const value of [snapshot.json, snapshot.html]) {
    const restored = await page.evaluate((content) => {
      window.__semloRequireFixture("statusSyncEditor").setContent(content);
      return window.__semloRequireFixture("statusSyncEditor").getSnapshot().json;
    }, value);
    expect(restored).toEqual(snapshot.json);
  }
});

test("status accepts at least the 104 characters observed in Yuque", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.getByRole("button", { name: "状态：待办" }).click();
  const label = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(4);
  const input = page.getByRole("textbox", { name: "状态文字" });
  await input.fill(label);
  await expect(input).toHaveValue(label);
  await input.press("Enter");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("statusSyncEditor").getSnapshot());
  expect(snapshot.json.content?.[0].content?.[0].attrs?.label).toBe(label);
  expect(await page.evaluate(() => window.__semloRequireFixture("statusSyncEditor").editor.commands.undo())).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("statusSyncEditor").editor.commands.redo())).toBe(true);
  for (const content of [snapshot.json, snapshot.html]) {
    const restored = await page.evaluate((value) => {
      window.__semloRequireFixture("statusSyncEditor").setContent(value);
      return window.__semloRequireFixture("statusSyncEditor").getSnapshot().json;
    }, content);
    expect(restored).toEqual(snapshot.json);
  }
});

test("status labels use the six measured background and foreground colors", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  const status = page.getByRole("button", { name: "状态：待办" });
  await status.click();
  const dialog = page.getByRole("dialog", { name: "编辑状态" });
  const colors = [
    ["红色", "rgb(248, 206, 211)", "rgb(112, 0, 13)"],
    ["黄色", "rgb(246, 225, 172)", "rgb(102, 73, 0)"],
    ["绿色", "rgb(219, 241, 183)", "rgb(42, 66, 0)"],
    ["灰色", "rgb(239, 240, 240)", "rgb(38, 38, 38)"],
    ["蓝色", "rgb(192, 221, 252)", "rgb(0, 52, 107)"],
    ["紫色", "rgb(192, 202, 252)", "rgb(16, 30, 96)"],
  ] as const;
  for (const [name, background, foreground] of colors) {
    await dialog.getByRole("button", { name }).click();
    await expect(status).toHaveCSS("background-color", background);
    await expect(status).toHaveCSS("color", foreground);
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("statusSyncEditor").getSnapshot());
    const staticColors = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.append(host);
      const node = host.querySelector<HTMLElement>("[data-semlo-editor-status]")!;
      const style = getComputedStyle(node);
      const result = { background: style.backgroundColor, foreground: style.color };
      host.remove();
      return result;
    }, snapshot.html);
    expect(staticColors).toEqual({ background, foreground });
    const restored = await page.evaluate((html) => {
      const controller = window.__semloRequireFixture("statusSyncEditor");
      controller.setContent("<p>临时</p>");
      controller.setContent(html);
      return controller.getSnapshot().json;
    }, snapshot.html);
    expect(restored).toEqual(snapshot.json);
    if (name !== "紫色") await status.click();
  }
});

test("explicit replacement of an equal status closes the old editor", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.getByRole("button", { name: "状态：待办" }).click();
  const panel = page.getByRole("dialog", { name: "编辑状态" });
  await expect(panel).toBeVisible();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("statusSyncEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorStatus") position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    const replacement = editor.schema.nodeFromJSON(node.toJSON());
    editor.view.dispatch(editor.state.tr.replaceWith(position, position + node.nodeSize, replacement));
  });
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "状态：待办" })).toBeVisible();
});

test("adjacent text edits and equal host echoes preserve the status editor", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.getByRole("button", { name: "状态：待办" }).click();
  const panel = page.getByRole("dialog", { name: "编辑状态" });
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("statusSyncEditor");
    controller.setContent(controller.getSnapshot().json);
    controller.editor.view.dispatch(controller.editor.state.tr.insertText("前文", 1));
  });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("状态文字")).toHaveValue("待办");
  await panel.getByLabel("状态文字").fill("进行中");
  await expect(page.getByRole("button", { name: "状态：进行中" })).toBeVisible();
});

test("rebuilding one equal status does not close another status editor", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.evaluate(() => {
    const status = { type: "semloEditorStatus", attrs: { label: "待办", color: 0 } };
    window.__semloRequireFixture("statusSyncEditor").setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [status, { type: "text", text: " " }, status] }],
    });
  });
  await page.getByRole("button", { name: "状态：待办" }).nth(1).click();
  const panel = page.getByRole("dialog", { name: "编辑状态" });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("statusSyncEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorStatus" && position < 0) position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(
      editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
    );
  });
  await expect(panel).toBeVisible();
  await panel.getByLabel("状态文字").fill("第二项");
  await expect(page.getByRole("button", { name: "状态：待办" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "状态：第二项" })).toHaveCount(1);
});

for (const action of ["label", "color"] as const) {
  test(`status ${action} tolerates synchronous host destruction`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.statusSyncEditor));
    await page.getByRole("button", { name: "状态：待办" }).click();
    const panel = page.getByRole("dialog", { name: "编辑状态" });
    await page.evaluate(() => Reflect.set(window, "destroyStatusEditor", true));
    if (action === "label") await panel.getByLabel("状态文字").fill("进行中");
    else await panel.getByRole("button", { name: "绿色" }).click();
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("statusSyncEditor").editor.isDestroyed)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("replacing one reused status node does not retarget the other status editor", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  const sharedReference = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("statusSyncEditor").editor;
    const status = editor.schema.nodes.semloEditorStatus.create({ label: "待办", color: 0 });
    const paragraph = editor.schema.nodes.paragraph.create(null, [status, editor.schema.text(" "), status]);
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, paragraph));
    const nodes: unknown[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "semloEditorStatus") nodes.push(node);
    });
    return nodes.length === 2 && nodes[0] === nodes[1];
  });
  expect(sharedReference).toBe(true);
  await page.getByRole("button", { name: "状态：待办" }).nth(1).click();
  const panel = page.getByRole("dialog", { name: "编辑状态" });
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("statusSyncEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorStatus" && position < 0) position = pos;
    });
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(
      editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
    );
  });
  await expect(panel).toBeVisible();
  await panel.getByLabel("状态文字").fill("第二项");
  await expect(page.getByRole("button", { name: "状态：待办", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "状态：第二项", exact: true })).toHaveCount(1);
});

test("status panel background interaction keeps Escape usable", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.getByRole("button", { name: "状态：待办" }).click();
  const panel = page.getByRole("dialog", { name: "编辑状态" });
  await panel.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("candidate selecting current status color does not emit document update", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.evaluate(() => {
    Reflect.set(window, "statusNoopUpdates", 0);
    window
      .__semloRequireFixture("statusSyncEditor")
      .editor.on("update", () =>
        Reflect.set(window, "statusNoopUpdates", Number(Reflect.get(window, "statusNoopUpdates")) + 1),
      );
  });
  await page.getByRole("button", { name: "状态：待办" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑状态" });
  await dialog.getByRole("button", { name: "红色" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "statusNoopUpdates"))).toBe(0);
  await dialog.getByRole("button", { name: "绿色" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "statusNoopUpdates"))).toBe(1);
  await expect(dialog.getByRole("button", { name: "绿色" })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => window.__semloRequireFixture("statusSyncEditor").editor.commands.undo());
  await expect(dialog.getByRole("button", { name: "红色" })).toHaveAttribute("aria-pressed", "true");
});

test("probe status panel reflects a synchronous host normalization", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("statusSyncEditor").editor;
    let done = false;
    editor.on("update", () => {
      if (done) return;
      done = true;
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "semloEditorStatus") pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: "规范后" }));
    });
  });
  await page.getByRole("button", { name: "状态：待办" }).click();
  const input = page.getByRole("dialog", { name: "编辑状态" }).getByLabel("状态文字");
  await input.fill("进行中");
  await expect(page.getByRole("button", { name: "状态：规范后" })).toBeVisible();
  await expect(input).toHaveValue("规范后");
});

test("probe status color palette reflects a synchronous host normalization", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("statusSyncEditor").editor;
    let done = false;
    editor.on("update", () => {
      if (done) return;
      done = true;
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "semloEditorStatus") pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, color: 4 }));
    });
  });
  await page.getByRole("button", { name: "状态：待办" }).click();
  const panel = page.getByRole("dialog", { name: "编辑状态" });
  await panel.getByRole("button", { name: "绿色" }).click();
  await expect(panel.getByRole("button", { name: "蓝色" })).toHaveAttribute("aria-pressed", "true");
});

test("candidate normal status input preserves caret when refreshed", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.getByRole("button", { name: "状态：待办" }).click();
  const input = page.getByRole("dialog", { name: "编辑状态" }).getByLabel("状态文字");
  await input.fill("abcd");
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2));
  await input.pressSequentially("X");
  await expect(input).toHaveValue("abXcd");
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(3);
});

test("candidate status composing input retains caret and ignores composing Escape", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.getByRole("button", { name: "状态：待办" }).click();
  const panel = page.getByRole("dialog", { name: "编辑状态" });
  const input = panel.getByLabel("状态文字");
  await input.evaluate((el: HTMLInputElement) => {
    el.value = "拼音";
    el.setSelectionRange(1, 1);
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: "音", inputType: "insertCompositionText", isComposing: true }),
    );
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }));
  });
  await expect(panel).toBeVisible();
  await expect(input).toHaveValue("拼音");
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(1);
  await input.evaluate((el: HTMLInputElement) =>
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
  );
});

test("candidate status equal node replacement during update closes old panel", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("statusSyncEditor").editor;
    let done = false;
    editor.on("update", () => {
      if (done) return;
      done = true;
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "semloEditorStatus") pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      editor.view.dispatch(
        editor.state.tr.replaceWith(pos, pos + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
      );
    });
  });
  await page.getByRole("button", { name: "状态：待办" }).click();
  const panel = page.getByRole("dialog", { name: "编辑状态" });
  await panel.getByLabel("状态文字").fill("进行中");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "状态：进行中" })).toBeVisible();
});

test("candidate defers host-normalized label until composition ends", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.statusSyncEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("statusSyncEditor").editor;
    let done = false;
    editor.on("update", () => {
      if (done) return;
      done = true;
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === "semloEditorStatus") pos = at;
      });
      const node = editor.state.doc.nodeAt(pos)!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: "规范后" }));
    });
  });
  await page.getByRole("button", { name: "状态：待办" }).click();
  const input = page.getByRole("dialog", { name: "编辑状态" }).getByLabel("状态文字");
  await input.evaluate((el: HTMLInputElement) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.value = "拼音";
    el.setSelectionRange(1, 1);
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: "音", inputType: "insertCompositionText", isComposing: true }),
    );
  });
  await expect(input).toHaveValue("拼音");
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(1);
  await input.evaluate((el: HTMLInputElement) =>
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
  );
  await expect(input).toHaveValue("规范后");
});
