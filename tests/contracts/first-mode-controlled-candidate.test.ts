import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { createFixtureRsbuild } from "../fixtures/browser/fixture-rsbuild";
import type {} from "../fixtures/list/ordered-restart-controlled-fixture";

let origin = "",
  close = async () => {};
beforeAll(async () => {
  const build = await createFixtureRsbuild("./tests/fixtures/list/ordered-restart-controlled-fixture.ts", {
    framework: true,
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  close = () => server.close();
});
afterAll(async () => close());

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} controlled first numbering mode survives echo, undo and reload`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.mountRestartControlledFixture);
    await page.evaluate((name) => window.mountRestartControlledFixture!(name, "legacy"), framework);
    await page.evaluate(() =>
      window.restartControlledFixture!.setContent("<ol><li><p>首项</p></li><li><p>次项</p></li></ol>"),
    );
    await page.evaluate(() => window.restartControlledFixture!.settle());
    const host = page.locator("#restart-controlled-fixture");
    await host.getByRole("button", { name: "设置列表编号：首项" }).click();
    const menu = page.getByRole("menu", { name: "设置列表编号" });
    await menu.getByRole("menuitem", { name: "继续编号" }).click();
    await page.evaluate(() => window.restartControlledFixture!.settle());
    const saved = await page.evaluate(() => window.restartControlledFixture!.controller.getSnapshot());
    expect(saved.json.content?.[0].attrs?.semloEditorListFirstContinue).toBe(true);
    expect(saved.html).toContain('data-semlo-editor-list-first-continue="true"');
    await page.evaluate(() => window.restartControlledFixture!.controller.editor.commands.undo());
    await page.evaluate(() => window.restartControlledFixture!.settle());
    expect(
      (await page.evaluate(() => window.restartControlledFixture!.controller.getSnapshot())).json.content?.[0].attrs
        ?.semloEditorListFirstContinue,
    ).toBeUndefined();
    await page.evaluate(() => window.restartControlledFixture!.controller.editor.commands.redo());
    await page.evaluate(() => window.restartControlledFixture!.settle());
    for (const content of [saved.json, saved.html]) {
      await page.evaluate((value) => window.restartControlledFixture!.setContent(value), content);
      await page.evaluate(() => window.restartControlledFixture!.settle());
      await host.getByRole("button", { name: "设置列表编号：首项" }).click();
      await expect(menu.getByRole("menuitem", { name: "继续编号" })).toBeDisabled();
      await page.keyboard.press("Escape");
    }
    expect(await page.evaluate(() => window.restartControlledFixture!.errors)).toEqual([]);
  });
}

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} controlled quote chain survives echo, undo and reload`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => window.mountRestartControlledFixture);
    await page.evaluate((name) => window.mountRestartControlledFixture!(name, "legacy"), framework);
    await page.evaluate(() =>
      window.restartControlledFixture!.setContent(
        '<ol data-semlo-editor-list-first-continue="true"><li><p>首项</p></li><li><p>次项</p></li><li><p>末项</p></li></ol>',
      ),
    );
    await page.evaluate(() => window.restartControlledFixture!.settle());
    const before = await page.evaluate(() => window.restartControlledFixture!.controller.getSnapshot().json);
    const host = page.locator("#restart-controlled-fixture");
    await host.getByText("次项", { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "引用", exact: true }).click();
    await page.evaluate(() => window.restartControlledFixture!.settle());
    const saved = await page.evaluate(() => window.restartControlledFixture!.controller.getSnapshot());
    expect(saved.json.content?.map((node) => node.type)).toEqual(["orderedList", "blockquote", "orderedList"]);
    expect((saved.html.match(/data-semlo-editor-list-quote-chain/g) ?? []).length).toBe(3);
    await host.getByText("次项", { exact: true }).hover();
    await page.locator(".semlo-editor-block-handle:visible").click();
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
    await page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "引用", exact: true }).click();
    await page.evaluate(() => window.restartControlledFixture!.settle());
    await expect(host.locator(".semlo-editor-prose ol")).toHaveCount(1);
    await page.evaluate(() => window.restartControlledFixture!.controller.editor.commands.undo());
    await page.evaluate(() => window.restartControlledFixture!.settle());
    expect(await page.evaluate(() => window.restartControlledFixture!.controller.getSnapshot().json)).toEqual(
      saved.json,
    );
    await page.evaluate(() => window.restartControlledFixture!.controller.editor.commands.undo());
    await page.evaluate(() => window.restartControlledFixture!.settle());
    expect(await page.evaluate(() => window.restartControlledFixture!.controller.getSnapshot().json)).toEqual(before);
    await page.evaluate(() => window.restartControlledFixture!.controller.editor.commands.redo());
    await page.evaluate(() => window.restartControlledFixture!.settle());
    const menu = page.getByRole("menu", { name: "设置列表编号" });
    for (const content of [saved.json, saved.html]) {
      await page.evaluate((value) => window.restartControlledFixture!.setContent(value), content);
      await page.evaluate(() => window.restartControlledFixture!.settle());
      await host.getByRole("button", { name: "设置列表编号：次项" }).click();
      await menu.getByRole("menuitem", { name: "重新编号" }).click();
      await page.evaluate(() => window.restartControlledFixture!.settle());
      expect(
        await host
          .locator(".semlo-editor-prose ol")
          .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOListElement).start)),
      ).toEqual([1, 1, 2]);
      await host.getByRole("button", { name: "设置列表编号：次项" }).click();
      await menu.getByRole("menuitem", { name: "继续编号" }).click();
      await page.evaluate(() => window.restartControlledFixture!.settle());
      expect(
        await host
          .locator(".semlo-editor-prose ol")
          .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOListElement).start)),
      ).toEqual([1, 2, 3]);
    }
    expect(await page.evaluate(() => window.restartControlledFixture!.errors)).toEqual([]);
  });
}
