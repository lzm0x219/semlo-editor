import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createFixtureRsbuild } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/list/list-fold-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin = "",
  stop = async () => {};
test.beforeAll(async () => {
  const rsbuild = await createFixtureRsbuild("./tests/fixtures/list/list-fold-fixture.ts", { publicDir: false });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = async () => {
    await server.close();
  };
});
test.afterAll(async () => {
  await stop();
});

test("folding hides descendants, preserves siblings, history and serialized content", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() => {
    const item = (text: string, level: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.__semloRequireFixture("createListFoldEditor")({
      type: "doc",
      content: [
        { type: "orderedList", content: [item("甲", 0), item("乙", 1), item("丙", 2), item("丁", 0)] },
        { type: "bulletList", content: [item("戊", 1)] },
      ],
    });
  });
  const fold = page.getByRole("button", { name: "折叠列表项：甲" });
  await fold.click({ force: true });
  await expect(page.getByText("乙")).toBeHidden();
  await expect(page.getByText("丙")).toBeHidden();
  await expect(page.getByText("丁")).toBeVisible();
  await expect(page.getByText("戊")).toBeVisible();
  const result = await page.evaluate(() => ({
    json: window.__semloRequireFixture("listFoldEditor").getJSON(),
    html: window.__semloRequireFixture("listFoldEditor").getHTML(),
  }));
  expect(result.json.content?.[0].content?.[0]).toMatchObject({ attrs: { semloEditorListFolded: true } });
  expect(result.html).toContain('data-semlo-editor-list-folded="true"');
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.undo());
  await expect(page.getByText("乙")).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("listFoldEditor").commands.redo());
  await expect(page.getByText("乙")).toBeHidden();
  for (const content of [result.json, result.html]) {
    await page.evaluate((value) => window.__semloRequireFixture("createListFoldEditor")(value), content);
    await expect(page.getByText("乙")).toBeHidden();
    await page.getByRole("button", { name: "展开列表项：甲" }).click();
    await expect(page.getByText("乙")).toBeVisible();
  }
});

test("nested folded states remain independent when the outer parent is toggled", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() => {
    const item = (text: string, level: number) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: level },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    window.__semloRequireFixture("createListFoldEditor")({
      type: "doc",
      content: [{ type: "bulletList", content: [item("甲", 0), item("乙", 1), item("丙", 2), item("丁", 0)] }],
    });
  });
  await page.getByRole("button", { name: "折叠列表项：乙" }).click({ force: true });
  await expect(page.getByText("丙")).toBeHidden();
  await page.getByRole("button", { name: "折叠列表项：甲" }).click({ force: true });
  await expect(page.getByText("乙")).toBeHidden();
  await page.getByRole("button", { name: "展开列表项：甲" }).click();
  await expect(page.getByText("乙")).toBeVisible();
  await expect(page.getByText("丙")).toBeHidden();
  await page.getByRole("button", { name: "展开列表项：乙" }).click();
  await expect(page.getByText("丙")).toBeVisible();
});

test("an imported nested list can be folded without deleting its contents", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => window.createListFoldEditor);
  await page.evaluate(() =>
    window.__semloRequireFixture("createListFoldEditor")(
      "<ul><li><p>甲</p><ul><li><p>乙</p></li></ul></li><li><p>丙</p></li></ul>",
    ),
  );
  await page.getByRole("button", { name: "折叠列表项：甲" }).click({ force: true });
  await expect(page.getByText("乙", { exact: true })).toBeHidden();
  await expect(page.getByText("丙", { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => ({
    json: window.__semloRequireFixture("listFoldEditor").getJSON(),
    html: window.__semloRequireFixture("listFoldEditor").getHTML(),
  }));
  for (const content of [saved.json, saved.html]) {
    await page.evaluate((value) => window.__semloRequireFixture("createListFoldEditor")(value), content);
    await expect(page.getByText("乙", { exact: true })).toBeHidden();
    await page.getByRole("button", { name: "展开列表项：甲" }).click();
    await expect(page.getByText("乙", { exact: true })).toBeVisible();
  }
});
