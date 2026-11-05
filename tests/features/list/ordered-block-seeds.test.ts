import { expect, test, type Page } from "@rstest/playwright";
import type { Locator } from "playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    orderedBlockSeedsEditor?: EditorController;
    orderedBlockSeedsChanges?: number;
    orderedBlockClipboardWrites?: number;
  }
}

const seeded =
  `<ol start="1" data-semlo-editor-list-level-starts='{"0":2,"1":2}'>` +
  '<li data-semlo-editor-list-indent="2"><p><em>丁丁</em></p></li>' +
  '<li data-semlo-editor-list-indent="1"><p><strong>戊戊</strong></p></li></ol><p>尾段</p>';

async function mount(page: Page, content: unknown = seeded) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'ordered-block-seeds-test'
      document.body.prepend(host)
      window.orderedBlockSeedsChanges = 0
      window.orderedBlockSeedsEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        onChange: () => { window.orderedBlockSeedsChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.orderedBlockSeedsEditor));
  return page.locator("#ordered-block-seeds-test");
}

async function snapshot(page: Page) {
  return page.evaluate(() => ({
    ...window.__semloRequireFixture("orderedBlockSeedsEditor").getSnapshot(),
    changes: window.__semloRequireFixture("orderedBlockSeedsChanges"),
  }));
}

async function markerInfo(page: Page) {
  return page.locator("#ordered-block-seeds-test .semlo-editor-prose > ol > li").evaluateAll((items) =>
    items.map((item) => ({
      text: item.textContent,
      value: item.getAttribute("value"),
      style: getComputedStyle(item).listStyleType,
      level: Number(item.getAttribute("data-semlo-editor-list-indent") ?? 0),
    })),
  );
}

async function markerNames(page: Page) {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#ordered-block-seeds-test",
    });
    const { node } = await session.send("DOM.describeNode", { nodeId });
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const first = nodes.find((candidate) => candidate.backendDOMNodeId === node.backendNodeId);
    if (!first) throw new Error("Editor missing from accessibility tree");
    const byId = new Map(nodes.map((entry) => [entry.nodeId, entry]));
    const result: string[] = [];
    const visit = (id: string) => {
      const entry = byId.get(id);
      if (!entry) return;
      if (entry.role?.value === "ListMarker") result.push(String(entry.name?.value ?? "").trim());
      entry.childIds?.forEach(visit);
    };
    visit(first.nodeId);
    return result;
  } finally {
    await session.detach();
  }
}

async function menuAction(page: Page, item: Locator, name: "删除" | "剪切") {
  await item.hover();
  const handle = page.locator(".semlo-editor-block-handle:visible");
  await handle.waitFor({ state: "visible" });
  await handle.click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name, exact: true }).click();
}

async function drag(page: Page, source: Locator, target: Locator, before = false) {
  await source.hover();
  const handle = page.locator(".semlo-editor-block-handle:visible");
  await handle.waitFor({ state: "visible" });
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Missing drag bounds");
  await page.mouse.move(from.x + 12, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x + 5, before ? to.y + 2 : to.y + to.height - 2, { steps: 10 });
  await page.mouse.up();
}

async function undoRedo(
  page: Page,
  before: Awaited<ReturnType<typeof snapshot>>,
  after: Awaited<ReturnType<typeof snapshot>>,
) {
  expect(
    await page.evaluate(() => window.__semloRequireFixture("orderedBlockSeedsEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("orderedBlockSeedsEditor").editor.commands.redo()),
  ).toBe(true);
  expect((await snapshot(page)).json).toEqual(after.json);
}

for (const action of ["删除", "剪切"] as const) {
  test(`block ${action} of the first item preserves the other level's start in one undo`, async ({ page }) => {
    const host = await mount(page);
    if (action === "剪切") {
      await page.evaluate(() => {
        window.orderedBlockClipboardWrites = 0;
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            write: async () => {
              window.__semloIncrementFixture("orderedBlockClipboardWrites");
            },
          },
        });
      });
    }
    expect(await markerNames(page)).toEqual(["i.", "b."]);
    const before = await snapshot(page);
    await menuAction(page, host.getByText("丁丁", { exact: true }), action);
    await expect(host.getByText("丁丁", { exact: true })).toHaveCount(0);
    if (action === "剪切") expect(await page.evaluate(() => window.orderedBlockClipboardWrites)).toBe(1);
    const after = await snapshot(page);
    expect(after.changes - before.changes).toBe(1);
    expect(await markerNames(page)).toEqual(["b."]);
    expect(await markerInfo(page)).toEqual([{ text: "戊戊", value: "2", style: "lower-alpha", level: 1 }]);
    expect(after.json.content?.[0].attrs).toMatchObject({ start: 2, semloEditorListLevelStarts: { "0": 2 } });
    expect(JSON.stringify(after.json)).toContain('"type":"bold"');
    await undoRedo(page, before, after);
    await page.evaluate((html) => window.__semloRequireFixture("orderedBlockSeedsEditor").setContent(html), after.html);
    expect((await snapshot(page)).json).toEqual(after.json);
  });
}

for (const mode of ["first-after", "second-before"] as const) {
  test(`moving ${mode} preserves both levels and starts in one undo`, async ({ page }) => {
    const host = await mount(page);
    const before = await snapshot(page);
    expect(await markerNames(page)).toEqual(["i.", "b."]);
    if (mode === "first-after")
      await drag(page, host.getByText("丁丁", { exact: true }), host.getByText("戊戊", { exact: true }));
    else await drag(page, host.getByText("戊戊", { exact: true }), host.getByText("丁丁", { exact: true }), true);
    const after = await snapshot(page);
    expect(after.json).not.toEqual(before.json);
    expect(after.changes - before.changes).toBe(1);
    expect(await markerNames(page)).toEqual(["b.", "i."]);
    expect(await markerInfo(page)).toEqual([
      { text: "戊戊", value: "2", style: "lower-alpha", level: 1 },
      { text: "丁丁", value: "1", style: "lower-roman", level: 2 },
    ]);
    expect(after.json.content?.[0].attrs).toMatchObject({ start: 2, semloEditorListLevelStarts: { "0": 2 } });
    await undoRedo(page, before, after);
  });
}

test("deleting a later item leaves the first item's stored start unchanged", async ({ page }) => {
  const host = await mount(page);
  const before = await snapshot(page);
  await menuAction(page, host.getByText("戊戊", { exact: true }), "删除");
  const after = await snapshot(page);
  expect(after.json.content?.[0].attrs).toEqual(before.json.content?.[0].attrs);
  expect(await markerNames(page)).toEqual(["i."]);
  await undoRedo(page, before, after);
});

test("plain ordered lists retain their existing start behavior", async ({ page }) => {
  const host = await mount(
    page,
    '<ol start="7"><li data-semlo-editor-list-indent="2"><p>丁丁</p></li><li data-semlo-editor-list-indent="1"><p>戊戊</p></li></ol><p>尾段</p>',
  );
  const before = await snapshot(page);
  await menuAction(page, host.getByText("丁丁", { exact: true }), "删除");
  const after = await snapshot(page);
  expect(after.json.content?.[0].attrs).toMatchObject({ start: 7 });
  expect(Object.hasOwn(after.json.content?.[0].attrs ?? {}, "semloEditorListLevelStarts")).toBe(false);
  expect(await markerNames(page)).toEqual(["g."]);
  await undoRedo(page, before, after);
});

test("invalid host level metadata prevents destructive first-item deletion", async ({ page }) => {
  const host = await mount(page, {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 1, semloEditorListLevelStarts: { "1": "bad" } },
        content: [
          {
            type: "listItem",
            attrs: { semloEditorListIndent: 2 },
            content: [{ type: "paragraph", content: [{ type: "text", text: "丁丁" }] }],
          },
          {
            type: "listItem",
            attrs: { semloEditorListIndent: 1 },
            content: [{ type: "paragraph", content: [{ type: "text", text: "戊戊" }] }],
          },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "尾段" }] },
    ],
  });
  const before = await snapshot(page);
  await menuAction(page, host.getByText("丁丁", { exact: true }), "删除");
  const after = await snapshot(page);
  expect(after.json).toEqual(before.json);
  expect(after.changes).toBe(before.changes);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("orderedBlockSeedsEditor").editor.commands.undo()),
  ).toBe(false);
});
