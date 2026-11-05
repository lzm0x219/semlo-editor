import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    galleryAppendEditor?: EditorController;
    galleryAppendTrigger?: (
      mode?:
        | "replace"
        | "local"
        | "before"
        | "both"
        | "equal"
        | "restore"
        | "clone"
        | "root-equal"
        | "root-clone"
        | "multi"
        | "multi-reverse",
    ) => void;
    galleryAppendIdentity?: boolean;
    galleryAppendResolve?: (url: string) => void;
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
      host.id = 'gallery-append-lifecycle'
      document.body.prepend(host)
      const controller = createEditor({ element: host, outline: false,
        content: { type:'doc', content:[{ type:'semloEditorGallery', attrs:{ data:{ id:'gallery', layout:'grid', images:[
          { id:'one', src:'/tests/sample-image.svg', title:'原图', href:'' }
        ] } } }, {type:'paragraph'}] },
        uploadImage: () => new Promise(resolve => { window.galleryAppendResolve = resolve })
      })
      const editor = controller.editor
      const key = new PluginKey('gallery-append-lifecycle')
      editor.registerPlugin(new Plugin({ key, appendTransaction(transactions, oldState, state) {
        const mode = transactions.map(transaction => transaction.getMeta(key)).find(Boolean)
        if (!mode) return null
        if (mode === 'root-equal' || mode === 'root-clone') return null
        if (mode === 'multi-reverse') return state.tr.insertText('后续局部', state.doc.content.size - 1)
        if (mode === 'equal' || mode === 'multi') return state.tr.replaceWith(0, state.doc.content.size, state.doc.content)
        if (mode === 'clone') return state.tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(state.doc.toJSON()).content)
        if (mode === 'restore') return state.tr.replaceWith(0, state.doc.content.size, oldState.doc.content)
        if (mode === 'local' || mode === 'both') return state.tr.insertText('局部', state.doc.content.size - 1)
        if (mode === 'before') return state.tr.insert(0, state.schema.nodes.paragraph.create(null, state.schema.text('前置')))
        const paragraph = state.schema.nodes.paragraph.create(null, state.schema.text('追加替换'))
        const replacement = state.doc.content.append(state.schema.nodes.doc.create(null, [paragraph]).content)
        return state.tr.replaceWith(0, state.doc.content.size, replacement)
      } }))
      editor.registerPlugin(new Plugin({ appendTransaction(transactions, _old, state) {
        if (transactions.some(transaction => transaction.getMeta(key) === 'multi-reverse'))
          return state.tr.replaceWith(0, state.doc.content.size, state.doc.content)
        if (!transactions.some(transaction => transaction.getMeta(key) === 'multi')) return null
        return state.tr.insertText('后续局部', state.doc.content.size - 1)
      } }))
      window.galleryAppendEditor = controller
      window.galleryAppendTrigger = (mode = 'replace') => {
        const prior = editor.state.doc.nodeAt(0)
        const tr = editor.state.tr
        if (mode === 'both') tr.insert(0, editor.schema.nodes.paragraph.create(null, editor.schema.text('主事务')))
        if (mode === 'restore') tr.insertText('临时', tr.doc.content.size - 1)
        if (mode === 'root-equal') tr.replaceWith(0, tr.doc.content.size, tr.doc.content)
        if (mode === 'root-clone') tr.replaceWith(0, tr.doc.content.size, editor.schema.nodeFromJSON(tr.doc.toJSON()).content)
        editor.view.dispatch(tr.setMeta(key, mode))
        window.galleryAppendIdentity = prior === editor.state.doc.nodeAt(0)
      }
    `,
  });
  await page.waitForFunction(() => Boolean(window.galleryAppendTrigger));
});

for (const mode of ["equal", "restore", "root-equal"] as const) {
  test(`a net equal ${mode} transaction preserves the gallery draft and pending upload`, async ({ page }) => {
    const host = page.locator("#gallery-append-lifecycle");
    await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
    await host.getByRole("button", { name: "编辑图册" }).click();
    const panel = page.getByRole("dialog", { name: "图册设置" });
    await panel.getByLabel("标题（图片一）").fill("保留草稿");
    await panel.locator('input[aria-label="选择图片文件"]').setInputFiles({
      name: "pending.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture"),
    });
    await page.waitForFunction(() => Boolean(window.galleryAppendResolve));
    await page.evaluate((kind) => window.__semloRequireFixture("galleryAppendTrigger")(kind), mode);
    expect(await page.evaluate(() => window.galleryAppendIdentity)).toBe(true);
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("标题（图片一）")).toHaveValue("保留草稿");
    await page.evaluate(() => window.__semloRequireFixture("galleryAppendResolve")("/tests/sample-image.svg?equal"));
    await expect(panel.getByRole("button", { name: "图片二", exact: true })).toBeVisible();
  });

  test(`a net equal ${mode} transaction preserves a direct gallery upload`, async ({ page }) => {
    const host = page.locator("#gallery-append-lifecycle");
    await host.locator('input[aria-label="选择图册图片"]').setInputFiles({
      name: "pending.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture"),
    });
    await page.waitForFunction(() => Boolean(window.galleryAppendResolve));
    await page.evaluate((kind) => window.__semloRequireFixture("galleryAppendTrigger")(kind), mode);
    await page.evaluate(() => window.__semloRequireFixture("galleryAppendResolve")("/tests/sample-image.svg?equal"));
    await expect(host.locator(".semlo-editor-gallery-grid img")).toHaveCount(2);
  });
}

for (const mode of ["replace", "clone", "root-clone"] as const) {
  test(`an appended ${mode} replacement closes the gallery draft and cancels its pending upload`, async ({ page }) => {
    const host = page.locator("#gallery-append-lifecycle");
    await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
    await host.getByRole("button", { name: "编辑图册" }).click();
    const panel = page.getByRole("dialog", { name: "图册设置" });
    await panel.getByLabel("标题（图片一）").fill("旧草稿");
    await panel.locator('input[aria-label="选择图片文件"]').setInputFiles({
      name: "pending.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture"),
    });
    await page.waitForFunction(() => Boolean(window.galleryAppendResolve));
    await page.evaluate((kind) => window.__semloRequireFixture("galleryAppendTrigger")(kind), mode);
    await expect(panel).toHaveCount(0);
    const before = await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").getSnapshot().json);
    await page.evaluate(async () => {
      window.__semloRequireFixture("galleryAppendResolve")("/tests/sample-image.svg?late");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").getSnapshot().json)).toEqual(
      before,
    );
  });

  test(`an appended ${mode} replacement cancels a direct gallery upload`, async ({ page }) => {
    const host = page.locator("#gallery-append-lifecycle");
    await host.locator('input[aria-label="选择图册图片"]').setInputFiles({
      name: "pending.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture"),
    });
    await page.waitForFunction(() => Boolean(window.galleryAppendResolve));
    await page.evaluate((kind) => window.__semloRequireFixture("galleryAppendTrigger")(kind), mode);
    const before = await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").getSnapshot().json);
    await page.evaluate(async () => {
      window.__semloRequireFixture("galleryAppendResolve")("/tests/sample-image.svg?late");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").getSnapshot().json)).toEqual(
      before,
    );
    await expect(host.locator(".semlo-editor-gallery-grid img")).toHaveCount(1);
  });
}

test("an appended local edit preserves the gallery draft and its pending upload", async ({ page }) => {
  const host = page.locator("#gallery-append-lifecycle");
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "编辑图册" }).click();
  const panel = page.getByRole("dialog", { name: "图册设置" });
  await panel.getByLabel("标题（图片一）").fill("保留草稿");
  await panel.locator('input[aria-label="选择图片文件"]').setInputFiles({
    name: "pending.png",
    mimeType: "image/png",
    buffer: Buffer.from("fixture"),
  });
  await page.waitForFunction(() => Boolean(window.galleryAppendResolve));
  await page.evaluate(() => window.__semloRequireFixture("galleryAppendTrigger")("local"));
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("标题（图片一）")).toHaveValue("保留草稿");
  await page.evaluate(() => window.__semloRequireFixture("galleryAppendResolve")("/tests/sample-image.svg?local"));
  await expect(panel.getByRole("button", { name: "图片二", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const saved = await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").getSnapshot().json);
  expect(saved.content?.[1].content?.[0].text).toBe("局部");
  const gallery = saved.content?.[0].attrs?.data as { images: Array<{ title: string }> };
  expect(gallery.images.map((image) => image.title)).toEqual(["保留草稿", ""]);
});

test("an appended local edit preserves a direct gallery upload", async ({ page }) => {
  const host = page.locator("#gallery-append-lifecycle");
  await host.locator('input[aria-label="选择图册图片"]').setInputFiles({
    name: "pending.png",
    mimeType: "image/png",
    buffer: Buffer.from("fixture"),
  });
  await page.waitForFunction(() => Boolean(window.galleryAppendResolve));
  await page.evaluate(() => {
    window.__semloRequireFixture("galleryAppendTrigger")("local");
    window.__semloRequireFixture("galleryAppendResolve")("/tests/sample-image.svg?local");
  });
  await expect(host.locator(".semlo-editor-gallery-grid img")).toHaveCount(2);
  const saved = await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").getSnapshot().json);
  expect(saved.content?.[1].content?.[0].text).toBe("局部");
});

test("an appended insertion before the gallery tracks its upload position", async ({ page }) => {
  const host = page.locator("#gallery-append-lifecycle");
  await host.locator('input[aria-label="选择图册图片"]').setInputFiles({
    name: "pending.png",
    mimeType: "image/png",
    buffer: Buffer.from("fixture"),
  });
  await page.waitForFunction(() => Boolean(window.galleryAppendResolve));
  await page.evaluate(() => {
    window.__semloRequireFixture("galleryAppendTrigger")("before");
    window.__semloRequireFixture("galleryAppendResolve")("/tests/sample-image.svg?shifted");
  });
  await expect(host.locator(".semlo-editor-gallery-grid img")).toHaveCount(2);
  const saved = await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").getSnapshot().json);
  expect(saved.content?.[0].content?.[0].text).toBe("前置");
  expect(saved.content?.[1].type).toBe("semloEditorGallery");
});

test("an appended insertion before the gallery preserves and commits its draft at the new position", async ({
  page,
}) => {
  const host = page.locator("#gallery-append-lifecycle");
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "编辑图册" }).click();
  const panel = page.getByRole("dialog", { name: "图册设置" });
  await panel.getByLabel("标题（图片一）").fill("移动后提交");
  await page.evaluate(() => window.__semloRequireFixture("galleryAppendTrigger")("before"));
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const saved = await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").getSnapshot().json);
  expect(saved.content?.[0].content?.[0].text).toBe("前置");
  const gallery = saved.content?.[1].attrs?.data as { images: Array<{ title: string }> };
  expect(gallery.images[0].title).toBe("移动后提交");
});

test("unrelated undo and redo preserve a pending gallery upload", async ({ page }) => {
  const host = page.locator("#gallery-append-lifecycle");
  await page.evaluate(() => window.__semloRequireFixture("galleryAppendTrigger")("local"));
  await host.locator('input[aria-label="选择图册图片"]').setInputFiles({
    name: "pending.png",
    mimeType: "image/png",
    buffer: Buffer.from("fixture"),
  });
  await page.waitForFunction(() => Boolean(window.galleryAppendResolve));
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").editor.commands.redo())).toBe(
    true,
  );
  await page.evaluate(() =>
    window.__semloRequireFixture("galleryAppendResolve")("/tests/sample-image.svg?after-history"),
  );
  await expect(host.locator(".semlo-editor-gallery-grid img")).toHaveCount(2);
});

test("root and appended document edits are mapped in order for a pending upload", async ({ page }) => {
  const host = page.locator("#gallery-append-lifecycle");
  await host.locator('input[aria-label="选择图册图片"]').setInputFiles({
    name: "pending.png",
    mimeType: "image/png",
    buffer: Buffer.from("fixture"),
  });
  await page.waitForFunction(() => Boolean(window.galleryAppendResolve));
  await page.evaluate(() => {
    window.__semloRequireFixture("galleryAppendTrigger")("both");
    window.__semloRequireFixture("galleryAppendResolve")("/tests/sample-image.svg?both");
  });
  await expect(host.locator(".semlo-editor-gallery-grid img")).toHaveCount(2);
  const saved = await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").getSnapshot().json);
  expect(saved.content?.[0].content?.[0].text).toBe("主事务");
  expect(saved.content?.[1].type).toBe("semloEditorGallery");
  expect(saved.content?.[2].content?.[0].text).toBe("局部");
});

for (const mode of ["multi", "multi-reverse"] as const) {
  test(`${mode} appended chain preserves a direct upload`, async ({ page }) => {
    const host = page.locator("#gallery-append-lifecycle");
    await host.locator('input[aria-label="选择图册图片"]').setInputFiles({
      name: "pending.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture"),
    });
    await page.waitForFunction(() => Boolean(window.galleryAppendResolve));
    await page.evaluate((kind) => {
      window.__semloRequireFixture("galleryAppendTrigger")(kind);
      window.__semloRequireFixture("galleryAppendResolve")("/tests/sample-image.svg?multi");
    }, mode);
    await expect(host.locator(".semlo-editor-gallery-grid img")).toHaveCount(2);
    const saved = await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").getSnapshot().json);
    expect(saved.content?.[1].content?.[0].text).toBe("后续局部");
  });

  test(`${mode} appended chain preserves the gallery draft`, async ({ page }) => {
    const host = page.locator("#gallery-append-lifecycle");
    await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
    await host.getByRole("button", { name: "编辑图册" }).click();
    const panel = page.getByRole("dialog", { name: "图册设置" });
    await panel.getByLabel("标题（图片一）").fill("保留草稿");
    await page.evaluate((kind) => window.__semloRequireFixture("galleryAppendTrigger")(kind), mode);
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("标题（图片一）")).toHaveValue("保留草稿");
    await panel.getByRole("button", { name: "确定", exact: true }).click();
    const saved = await page.evaluate(() => window.__semloRequireFixture("galleryAppendEditor").getSnapshot().json);
    expect(saved.content?.[1].content?.[0].text).toBe("后续局部");
  });
}
