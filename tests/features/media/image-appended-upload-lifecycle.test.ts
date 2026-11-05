import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    imageAppendEditor?: EditorController;
    imageAppendResolve?: (url: string) => void;
    imageAppendFirstResolve?: (url: string) => void;
    imageAppendReject?: (error: Error) => void;
    imageAppendErrors?: string[];
    imageAppendDestroyOnError?: boolean;
    imageAppendTrigger?: (
      mode:
        | "equal"
        | "local"
        | "restore"
        | "replace"
        | "clone"
        | "root-equal"
        | "root-clone"
        | "multi"
        | "multi-reverse",
    ) => void;
    imageAppendAuto?: "add-equal" | "remove-restore" | "clear-equal" | "remove-equal";
    imageOtherAppend?: () => void;
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
        import { createEditor, Plugin, PluginKey } from '/dist/index.js'
        const host = document.createElement('div')
        host.id = 'image-append-probe'
        document.body.prepend(host)
        window.imageAppendErrors = []
        const controller = createEditor({ element: host, outline: false, content: '<p>原文</p>',
          uploadImage: () => new Promise((resolve, reject) => { window.imageAppendResolve = resolve; window.imageAppendReject = reject }),
          onError: error => { window.imageAppendErrors.push(error.message); if (window.imageAppendDestroyOnError) controller.destroy() } })
        const editor = controller.editor
        const key = new PluginKey('image-append-probe')
        editor.registerPlugin(new Plugin({ key, appendTransaction(transactions, oldState, state) {
          const upload = transactions.map(tr => Object.entries(tr.meta).find(([k]) => k.startsWith('semlo-editor-image-upload'))?.[1]).find(Boolean)
          if (window.imageAppendAuto === 'add-equal' && upload?.add) {
            window.imageAppendAuto = undefined
            return state.tr.replaceWith(0, state.doc.content.size, state.doc.content)
          }
          if (window.imageAppendAuto === 'remove-restore' && upload?.remove && transactions.some(tr => tr.docChanged)) {
            window.imageAppendAuto = undefined
            return state.tr.replaceWith(0, state.doc.content.size, oldState.doc.content)
          }
          if (window.imageAppendAuto === 'clear-equal' && upload?.clear) {
            window.imageAppendAuto = undefined
            return state.tr.replaceWith(0, state.doc.content.size, state.doc.content)
          }
          if (window.imageAppendAuto === 'remove-equal' && upload?.remove) {
            window.imageAppendAuto = undefined
            return state.tr.replaceWith(0, state.doc.content.size, state.doc.content)
          }
          const mode = transactions.map(transaction => transaction.getMeta(key)).find(Boolean)
          if (mode === 'multi-reverse') return state.tr.insertText('续', state.doc.content.size - 1)
          if (mode === 'equal' || mode === 'multi') return state.tr.replaceWith(0, state.doc.content.size, state.doc.content)
          if (mode === 'clone') return state.tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(state.doc.toJSON()).content)
          if (mode === 'restore') return state.tr.replaceWith(0, state.doc.content.size, oldState.doc.content)
          if (mode === 'replace') return state.tr.replaceWith(0, state.doc.content.size, state.schema.nodes.paragraph.create(null, state.schema.text('替换')))
          if (mode === 'local') return state.tr.insertText('续', state.doc.content.size - 1)
          return null
        } }))
        editor.registerPlugin(new Plugin({ appendTransaction(transactions, _old, state) {
          if (transactions.some(tr => tr.getMeta(key) === 'multi-reverse'))
            return state.tr.replaceWith(0, state.doc.content.size, state.doc.content)
          if (!transactions.some(tr => tr.getMeta(key) === 'multi')) return null
          return state.tr.insertText('续', state.doc.content.size - 1)
        } }))
        window.imageAppendEditor = controller
        window.imageAppendTrigger = mode => {
          const tr = editor.state.tr
          if (mode === 'restore') tr.insertText('临时', tr.doc.content.size - 1)
          if (mode === 'root-equal') tr.replaceWith(0, tr.doc.content.size, tr.doc.content)
          if (mode === 'root-clone') tr.replaceWith(0, tr.doc.content.size, editor.schema.nodeFromJSON(tr.doc.toJSON()).content)
          editor.view.dispatch(tr.setMeta(key, mode))
        }
      `,
  });
  await page.waitForFunction(() => Boolean(window.imageAppendTrigger));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imageAppendEditor").editor;
    editor.commands.setTextSelection(2);
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], "pending.png", { type: "image/png" }));
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  });
  await page.waitForFunction(() => Boolean(window.imageAppendResolve));
});

for (const mode of [
  "equal",
  "local",
  "restore",
  "replace",
  "clone",
  "root-equal",
  "root-clone",
  "multi",
  "multi-reverse",
] as const) {
  test(`a ${mode} appended transaction keeps an in-flight image upload anchored`, async ({ page }) => {
    const host = page.locator("#image-append-probe");
    await expect(host.locator(".semlo-editor-uploading")).toHaveCount(1);
    await page.evaluate((kind) => window.__semloRequireFixture("imageAppendTrigger")(kind), mode);
    if (mode === "replace" || mode === "clone" || mode === "root-clone") {
      await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
      await page.evaluate(async () => {
        window.__semloRequireFixture("imageAppendResolve")("/tests/sample-image.svg");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await expect(host.locator(".semlo-editor-image-node")).toHaveCount(0);
      await expect(host.locator(".semlo-editor-prose")).toHaveText(mode === "replace" ? "替换" : "原文");
      return;
    }
    await expect(host.locator(".semlo-editor-uploading")).toHaveCount(1);
    await page.evaluate(() => window.__semloRequireFixture("imageAppendResolve")("/tests/sample-image.svg"));
    await expect(host.locator(".semlo-editor-image-node")).toHaveCount(1);
  });
}

for (const mode of ["equal", "restore", "replace", "clone"] as const) {
  test(`a pending upload failure after ${mode} is handled according to its lifetime`, async ({ page }) => {
    const host = page.locator("#image-append-probe");
    await page.evaluate((kind) => window.__semloRequireFixture("imageAppendTrigger")(kind), mode);
    await page.evaluate(async () => {
      window.__semloRequireFixture("imageAppendReject")(new Error("上传失败"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("imageAppendErrors"))).toEqual(
      mode === "replace" || mode === "clone" ? [] : ["上传失败"],
    );
  });
}

test("a failure callback may destroy the editor reentrantly after an equal appended transaction", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(async () => {
    window.__semloRequireFixture("imageAppendTrigger")("equal");
    window.imageAppendDestroyOnError = true;
    window.__semloRequireFixture("imageAppendReject")(new Error("上传失败"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("imageAppendErrors"))).toEqual(["上传失败"]);
  expect(errors).toEqual([]);
  await expect(page.locator("#image-append-probe .semlo-editor-uploading")).toHaveCount(0);
});

test("an equal append triggered during a second placeholder addition preserves both uploads", async ({ page }) => {
  const host = page.locator("#image-append-probe");
  await page.evaluate(() => {
    window.imageAppendFirstResolve = window.imageAppendResolve;
    window.imageAppendAuto = "add-equal";
    const editor = window.__semloRequireFixture("imageAppendEditor").editor;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], "second.png", { type: "image/png" }));
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  });
  await expect(host.locator(".semlo-editor-uploading")).toHaveCount(2);
  await page.evaluate(() => window.__semloRequireFixture("imageAppendFirstResolve")("/tests/sample-image.svg?first"));
  await expect(host.locator(".semlo-editor-image-node")).toHaveCount(1);
  await expect(host.locator(".semlo-editor-uploading")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("imageAppendResolve")("/tests/sample-image.svg?second"));
  await expect(host.locator(".semlo-editor-image-node")).toHaveCount(2);
});

test("a placeholder removed by successful upload is not resurrected by an appended restoration", async ({ page }) => {
  const host = page.locator("#image-append-probe");
  await page.evaluate(async () => {
    window.imageAppendAuto = "remove-restore";
    window.__semloRequireFixture("imageAppendResolve")("/tests/sample-image.svg");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-image-node")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose")).toHaveText("原文");
});

test("an explicit clear cannot resurrect a placeholder through an equal append", async ({ page }) => {
  const host = page.locator("#image-append-probe");
  await page.evaluate(() => {
    window.imageAppendAuto = "clear-equal";
    window.__semloRequireFixture("imageAppendEditor").setEditable(false);
    window.__semloRequireFixture("imageAppendEditor").setEditable(true);
  });
  await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
  await page.evaluate(async () => {
    window.__semloRequireFixture("imageAppendResolve")("/tests/sample-image.svg");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await expect(host.locator(".semlo-editor-image-node")).toHaveCount(0);
});

test("a failed upload's removed placeholder stays removed through an equal append", async ({ page }) => {
  const host = page.locator("#image-append-probe");
  await page.evaluate(async () => {
    window.imageAppendAuto = "remove-equal";
    window.__semloRequireFixture("imageAppendReject")(new Error("上传失败"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("imageAppendErrors"))).toEqual(["上传失败"]);
});

for (const position of [1, 3] as const) {
  test(`a pending upload at text boundary ${position} returns to its original location`, async ({ page }) => {
    const host = page.locator("#image-append-probe");
    await page.evaluate((pos) => {
      window.imageAppendFirstResolve = window.imageAppendResolve;
      const editor = window.__semloRequireFixture("imageAppendEditor").editor;
      editor.commands.setTextSelection(pos);
      const transfer = new DataTransfer();
      transfer.items.add(new File(["image"], "boundary.png", { type: "image/png" }));
      editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, position);
    await expect(host.locator(".semlo-editor-uploading")).toHaveCount(2);
    await page.evaluate(() => {
      window.__semloRequireFixture("imageAppendTrigger")("equal");
      window.__semloRequireFixture("imageAppendResolve")("/tests/sample-image.svg?boundary");
    });
    await expect(host.locator(".semlo-editor-image-node")).toHaveCount(1);
    const saved = await page.evaluate(() => window.__semloRequireFixture("imageAppendEditor").getSnapshot().json);
    const content = saved.content?.[0].content ?? [];
    expect(content.map((node) => node.type)).toEqual(position === 1 ? ["image", "text"] : ["text", "image"]);
    expect(content.find((node) => node.type === "text")?.text).toBe("原文");
    await expect(host.locator(".semlo-editor-uploading")).toHaveCount(1);
    await page.evaluate(() => window.__semloRequireFixture("imageAppendFirstResolve")("/tests/sample-image.svg?first"));
    await expect(host.locator(".semlo-editor-image-node")).toHaveCount(2);
  });
}

test("an equivalent setContent leaves the in-flight upload intact", async ({ page }) => {
  const host = page.locator("#image-append-probe");
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("imageAppendEditor");
    controller.setContent(structuredClone(controller.getSnapshot().json));
    window.__semloRequireFixture("imageAppendResolve")("/tests/sample-image.svg");
  });
  await expect(host.locator(".semlo-editor-image-node")).toHaveCount(1);
});

test("unrelated undo and redo preserve an in-flight upload", async ({ page }) => {
  const host = page.locator("#image-append-probe");
  await page.evaluate(() => window.__semloRequireFixture("imageAppendTrigger")("local"));
  expect(await page.evaluate(() => window.__semloRequireFixture("imageAppendEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("imageAppendEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(host.locator(".semlo-editor-uploading")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("imageAppendResolve")("/tests/sample-image.svg"));
  await expect(host.locator(".semlo-editor-image-node")).toHaveCount(1);
});

test("an appended replacement in a different editor does not cancel this upload", async ({ page }) => {
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Plugin, PluginKey } from '/dist/index.js'
      const host = document.createElement('div')
      document.body.prepend(host)
      const other = createEditor({element:host, outline:false, content:'<p>另一个编辑器</p>'}).editor
      const key = new PluginKey('image-other-append')
      other.registerPlugin(new Plugin({ key, appendTransaction(transactions, _old, state) {
        if (!transactions.some(tr => tr.getMeta(key))) return null
        return state.tr.replaceWith(0, state.doc.content.size, state.schema.nodes.paragraph.create(null, state.schema.text('替换')))
      } }))
      window.imageOtherAppend = () => other.view.dispatch(other.state.tr.setMeta(key, true))
    `,
  });
  await page.waitForFunction(() => Boolean(window.imageOtherAppend));
  await page.evaluate(() => {
    window.__semloRequireFixture("imageOtherAppend")();
    window.__semloRequireFixture("imageAppendResolve")("/tests/sample-image.svg");
  });
  await expect(page.locator("#image-append-probe .semlo-editor-image-node")).toHaveCount(1);
});

test("a successful upload can trigger editor destruction in an update callback", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("imageAppendEditor");
    controller.editor.on("update", () => {
      if (controller.getSnapshot().json.content?.[0].content?.some((node) => node.type === "image"))
        controller.destroy();
    });
    window.__semloRequireFixture("imageAppendTrigger")("equal");
    window.__semloRequireFixture("imageAppendResolve")("/tests/sample-image.svg");
  });
  await expect
    .poll(() => page.evaluate(() => window.__semloRequireFixture("imageAppendEditor").editor.isDestroyed))
    .toBe(true);
  expect(errors).toEqual([]);
});
