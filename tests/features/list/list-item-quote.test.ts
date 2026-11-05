import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/list/task-item-conversion-fixture";

let origin = "";
let stop = async () => {};

test.beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/list/task-item-conversion-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = async () => {
    await server.close();
  };
});

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
test.afterAll(async () => {
  await stop();
});

for (const [kind, wrapper, label] of [
  ["orderedList", "blockquote", "引用"],
  ["taskList", "blockquote", "引用"],
  ["orderedList", "callout", "高亮块"],
  ["taskList", "callout", "高亮块"],
  ["orderedList", "semloEditorColumns", "分栏"],
  ["taskList", "semloEditorColumns", "分栏"],
  ["orderedList", "details", "折叠块"],
  ["taskList", "details", "折叠块"],
] as const) {
  test(`${kind} item becomes ${wrapper} without losing its list or neighbours`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.taskConversionCreate);
    await page.evaluate((kind) => {
      document.body.replaceChildren();
      const host = document.createElement("div");
      document.body.append(host);
      const item = (text: string) => ({
        type: kind === "taskList" ? "taskItem" : "listItem",
        attrs: kind === "taskList" ? { checked: true } : {},
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      window.taskConversionEditor = window.__semloRequireFixture("taskConversionCreate")({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [
            {
              type: kind,
              attrs: kind === "orderedList" ? { start: 7 } : {},
              content: [item("甲"), item("乙"), item("丙")],
            },
          ],
        },
      });
    }, kind);
    const snapshot = () => page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").getSnapshot());
    const before = await snapshot();
    await page.locator(".semlo-editor-prose").getByText("乙", { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await expect(
      page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "引用", exact: true }),
    ).toBeEnabled();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: label, exact: true }).click();
    const after = await snapshot();
    expect(after.json.content?.map((node) => node.type)).toEqual([kind, wrapper, kind]);
    const nodes = after.json.content!;
    const inner =
      wrapper === "semloEditorColumns"
        ? nodes[1].content?.[0].content?.[0]
        : wrapper === "details"
          ? nodes[1].content?.[1].content?.[0]
          : nodes[1].content?.[0];
    expect(inner?.type).toBe(kind);
    if (wrapper === "semloEditorColumns") expect(nodes[1].content).toHaveLength(2);
    if (wrapper === "details") {
      expect(nodes[1].content?.[0].type).toBe("detailsSummary");
      expect(
        await page.evaluate(
          () => window.__semloRequireFixture("taskConversionEditor").editor.state.selection.$from.parent.type.name,
        ),
      ).toBe("detailsSummary");
    }
    if (kind === "orderedList") {
      expect(inner?.attrs?.start).toBe(8);
      expect(nodes[2].attrs?.start).toBe(9);
    } else expect(inner?.content?.[0].attrs?.checked).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(before.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("taskConversionEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await snapshot()).json).toEqual(after.json);
    for (const key of ["json", "html"] as const) {
      const restored = await page.evaluate((content) => {
        window.__semloRequireFixture("taskConversionEditor").setContent(content);
        return window.__semloRequireFixture("taskConversionEditor").getSnapshot().json;
      }, after[key]);
      expect(restored).toEqual(after.json);
    }
  });
}
