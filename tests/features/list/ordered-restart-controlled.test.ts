import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type { RestartDocument, RestartFramework } from "../../fixtures/list/ordered-restart-controlled-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let closeServer: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/list/ordered-restart-controlled-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core$": "./packages/core/src/index.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  closeServer = () => server.close();
});
afterAll(async () => closeServer?.());

async function settle(page: Page) {
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
}

function snapshotValues(json: JSONContent): Array<boolean | "omitted"> {
  const list = json.content?.find((node) => node.type === "orderedList");
  if (!list?.content) throw new Error("Missing ordered list");
  return list.content.map((node) =>
    Object.hasOwn(node.attrs ?? {}, "semloEditorListRestart") ? node.attrs!.semloEditorListRestart : "omitted",
  );
}

async function readState(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("restartControlledFixture");
    const editor = fixture.controller.editor;
    const liveValues: unknown[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "listItem") liveValues.push(node.attrs.semloEditorListRestart);
    });
    const selection = editor.state.selection;
    return {
      schemaDefault: editor.schema.nodes.listItem.spec.attrs?.semloEditorListRestart?.default,
      liveValues,
      snapshot: fixture.controller.getSnapshot(),
      changes: fixture.changes,
      documentChanges: fixture.documentChanges,
      errors: fixture.errors,
      focused: editor.view.dom === document.activeElement,
      selection: { anchor: selection.anchor, head: selection.head },
    };
  });
}

async function htmlRestarts(page: Page, html: string) {
  return page.evaluate((value) => {
    const doc = new DOMParser().parseFromString(value, "text/html");
    return [...doc.querySelectorAll("ol > li")].map((item) => item.getAttribute("data-semlo-editor-list-restart"));
  }, html);
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  for (const variant of ["legacy", "restarted"] as const satisfies readonly RestartDocument[]) {
    test(`${framework}: ${variant} restart attrs survive controlled echoes, input, undo and JSON/HTML`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
      await page.evaluate(
        ({ framework, variant }) => window.__semloRequireFixture("mountRestartControlledFixture")(framework, variant),
        {
          framework,
          variant,
        },
      );
      await settle(page);

      const expectedLive = [false, variant === "restarted", false];
      const expectedSnapshot = ["omitted", variant === "restarted" ? true : "omitted", "omitted"];
      const expectedHtml = [null, variant === "restarted" ? "true" : null, null];
      const host = page.locator("#restart-controlled-fixture");
      const second = host.locator(".semlo-editor-prose ol > li").nth(1).locator("p").first();
      await expect(second).toHaveText("第二项");

      const initial = await readState(page);
      expect(initial.schemaDefault).toBe(false);
      expect(initial.liveValues).toEqual(expectedLive);
      expect(snapshotValues(initial.snapshot.json)).toEqual(expectedSnapshot);
      expect(await htmlRestarts(page, initial.snapshot.html)).toEqual(expectedHtml);
      expect(initial.changes).toHaveLength(0);
      expect(initial.documentChanges).toBe(0);

      await second.click();
      await page.keyboard.press("End");
      await page.keyboard.insertText("改");
      await settle(page);
      await expect(second).toHaveText("第二项改");
      const edited = await readState(page);
      expect(edited.focused).toBe(true);
      expect(edited.selection.anchor).toBe(edited.selection.head);
      expect(edited.liveValues).toEqual(expectedLive);
      expect(snapshotValues(edited.snapshot.json)).toEqual(expectedSnapshot);
      expect(edited.changes).toHaveLength(1);
      expect(snapshotValues(edited.changes[0].json)).toEqual(expectedSnapshot);
      expect(edited.documentChanges).toBe(1);
      expect(await htmlRestarts(page, edited.changes[0].html)).toEqual(expectedHtml);

      // Echoing the normalized snapshot a second time must neither replace
      // the document nor disturb selection/focus in any of the four entries.
      await page.evaluate(
        (content) => window.__semloRequireFixture("restartControlledFixture").setContent(content),
        edited.snapshot.json,
      );
      await settle(page);
      await settle(page);
      const echoed = await readState(page);
      expect(echoed.focused).toBe(true);
      expect(echoed.selection).toEqual(edited.selection);
      expect(echoed.documentChanges).toBe(1);
      expect(echoed.changes).toHaveLength(1);

      await page.keyboard.press("ControlOrMeta+z");
      await settle(page);
      await expect(second).toHaveText("第二项");
      const undone = await readState(page);
      expect(undone.focused).toBe(true);
      expect(undone.liveValues).toEqual(expectedLive);
      expect(snapshotValues(undone.snapshot.json)).toEqual(expectedSnapshot);
      expect(undone.changes).toHaveLength(2);
      expect(snapshotValues(undone.changes[1].json)).toEqual(expectedSnapshot);
      expect(undone.documentChanges).toBe(2);

      for (const content of [edited.snapshot.json, edited.snapshot.html]) {
        await page.evaluate(() =>
          window.__semloRequireFixture("restartControlledFixture").setContent("<p>临时替换</p>"),
        );
        await settle(page);
        await expect(host.locator(".semlo-editor-prose")).toContainText("临时替换");
        await page.evaluate(
          (value) => window.__semloRequireFixture("restartControlledFixture").setContent(value),
          content,
        );
        await settle(page);
        await expect(second).toHaveText("第二项改");
        const restored = await readState(page);
        expect(restored.liveValues).toEqual(expectedLive);
        expect(snapshotValues(restored.snapshot.json)).toEqual(expectedSnapshot);
        expect(restored.snapshot.json).toEqual(edited.snapshot.json);
        expect(await htmlRestarts(page, restored.snapshot.html)).toEqual(expectedHtml);
        expect(restored.changes).toHaveLength(2);
      }

      const result = await readState(page);
      expect(result.errors).toEqual([]);
      expect(pageErrors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
    });
  }
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  test(`${framework}: nested numbering menu survives controlled echoes and undo`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
    await page.evaluate(
      (value) => window.__semloRequireFixture("mountRestartControlledFixture")(value, "legacy"),
      framework,
    );
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: ["Parent", "ChildA", "ChildB"].map((text, index) => ({
            type: "listItem",
            attrs: { semloEditorListIndent: index ? 1 : 0 },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
      ],
    };
    await page.evaluate((value) => window.__semloRequireFixture("restartControlledFixture").setContent(value), content);
    await settle(page);
    await settle(page);
    const before = await readState(page);
    const trigger = page.getByRole("button", { name: "设置列表编号：ChildB" });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "设置列表编号" });
    await menu.getByRole("menuitem", { name: "重新编号" }).click();
    await settle(page);
    await settle(page);
    const restarted = await readState(page);
    expect(restarted.liveValues).toEqual([false, false, true]);
    expect(restarted.changes.length - before.changes.length).toBe(1);
    expect(restarted.documentChanges - before.documentChanges).toBe(1);
    expect(restarted.errors).toEqual([]);
    expect(await htmlRestarts(page, restarted.snapshot.html)).toEqual([null, null, "true"]);
    await page.evaluate(() =>
      window.__semloRequireFixture("restartControlledFixture").controller.editor.commands.undo(),
    );
    await settle(page);
    expect((await readState(page)).liveValues).toEqual([false, false, false]);
    await page.evaluate(() =>
      window.__semloRequireFixture("restartControlledFixture").controller.editor.commands.redo(),
    );
    await settle(page);
    expect((await readState(page)).liveValues).toEqual([false, false, true]);
    await trigger.click();
    await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeEnabled();
    await menu.getByRole("menuitem", { name: "继续编号" }).click();
    await settle(page);
    expect((await readState(page)).liveValues).toEqual([false, false, false]);
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  test(`${framework}: two nested restarts survive controlled echoes and continuing one`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
    await page.evaluate(
      (value) => window.__semloRequireFixture("mountRestartControlledFixture")(value, "legacy"),
      framework,
    );
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: ["Parent", "A", "B", "C", "D", "E"].map((text, index) => ({
            type: "listItem",
            attrs: { semloEditorListIndent: index ? 1 : 0 },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
      ],
    };
    await page.evaluate((value) => window.__semloRequireFixture("restartControlledFixture").setContent(value), content);
    await settle(page);
    await settle(page);
    const before = await readState(page);
    const menu = page.getByRole("menu", { name: "设置列表编号" });
    for (const name of ["B", "D"]) {
      await page.getByRole("button", { name: `设置列表编号：${name}`, exact: true }).click();
      await menu.getByRole("menuitem", { name: "重新编号" }).click();
      await settle(page);
      await settle(page);
    }
    const restarted = await readState(page);
    expect(restarted.liveValues).toEqual([false, false, true, false, true, false]);
    expect(restarted.changes.length - before.changes.length).toBe(2);
    expect(restarted.documentChanges - before.documentChanges).toBe(2);
    await page.getByRole("button", { name: "设置列表编号：B", exact: true }).click();
    await menu.getByRole("menuitem", { name: "继续编号" }).click();
    await settle(page);
    await settle(page);
    const continued = await readState(page);
    expect(continued.liveValues).toEqual([false, false, false, false, true, false]);
    expect(continued.changes.length - before.changes.length).toBe(3);
    expect(continued.documentChanges - before.documentChanges).toBe(3);
    expect(continued.errors).toEqual([]);
    await page.evaluate(() =>
      window.__semloRequireFixture("restartControlledFixture").controller.editor.commands.undo(),
    );
    await settle(page);
    expect((await readState(page)).liveValues).toEqual(restarted.liveValues);
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  test(`${framework}: task conversion retains the linked continuation through controlled echoes`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
    await page.evaluate(
      (value) => window.__semloRequireFixture("mountRestartControlledFixture")(value, "legacy"),
      framework,
    );
    const item = (text: string, level: number, restart = false) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level, semloEditorListRestart: restart },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: [item("Parent", 0), item("A", 1), item("B", 1, true), item("C", 1)],
        },
      ],
    };
    await page.evaluate((value) => window.__semloRequireFixture("restartControlledFixture").setContent(value), content);
    await settle(page);
    await settle(page);
    const initial = await readState(page);
    await page.locator("#restart-controlled-fixture .semlo-editor-prose").getByText("B", { exact: true }).click();
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: "待办事项", exact: true }).click({ timeout: 3000 });
    await settle(page);
    await settle(page);
    const converted = await readState(page);
    expect(converted.snapshot.json.content?.map((node) => node.type)).toEqual([
      "orderedList",
      "taskList",
      "orderedList",
    ]);
    expect(converted.documentChanges - initial.documentChanges).toBe(1);
    expect(converted.changes.length - initial.changes.length).toBe(1);
    expect(converted.errors).toEqual([]);
    await page.getByRole("button", { name: "设置列表编号：C", exact: true }).click();
    await page.getByRole("menu", { name: "设置列表编号" }).getByRole("menuitem", { name: "修改样式" }).click();
    await page.getByRole("menu", { name: "有序列表样式" }).getByRole("menuitemradio", { name: "中文数字" }).click();
    await settle(page);
    await settle(page);
    const chinese = await readState(page);
    expect(chinese.documentChanges - initial.documentChanges).toBe(2);
    expect(chinese.changes.length - initial.changes.length).toBe(2);
    await expect(page.locator("#restart-controlled-fixture .semlo-editor-prose ol").last().locator("> li")).toHaveCSS(
      "list-style-type",
      '"(一) "',
    );
    await page.getByRole("button", { name: "设置列表编号：C", exact: true }).click();
    await page.getByRole("menu", { name: "设置列表编号" }).getByRole("menuitem", { name: "继续编号" }).click();
    await settle(page);
    await settle(page);
    const continued = await readState(page);
    expect(continued.documentChanges - initial.documentChanges).toBe(3);
    expect(continued.changes.length - initial.changes.length).toBe(3);
    await expect(page.locator("#restart-controlled-fixture .semlo-editor-prose ol").last().locator("> li")).toHaveCSS(
      "list-style-type",
      '"1.2. "',
    );
    await page.evaluate(() =>
      window.__semloRequireFixture("restartControlledFixture").controller.editor.commands.undo(),
    );
    await settle(page);
    expect((await readState(page)).snapshot.json).toEqual(chinese.snapshot.json);
    await page.evaluate(() =>
      window.__semloRequireFixture("restartControlledFixture").controller.editor.commands.undo(),
    );
    await settle(page);
    expect((await readState(page)).snapshot.json).toEqual(converted.snapshot.json);
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
  });
}
