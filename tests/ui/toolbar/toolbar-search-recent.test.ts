import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

test("searched quick commands appear and execute from recent inserts", async ({ page }) => {
  for (const table of [false, true]) {
    const rsbuild = await createRsbuild({
      cwd: process.cwd(),
      rsbuildConfig: {
        source: {
          entry: {
            index: table
              ? "./tests/fixtures/toolbar/toolbar-table-insert-fixture.ts"
              : "./tests/fixtures/toolbar/toolbar-search-recent-root-fixture.ts",
          },
        },
        server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
        dev: { hmr: false, liveReload: false },
        output: { distPath: { root: "/tmp/semlo-editor-search-recent-unused" } },
      },
    });
    const { port, server } = await rsbuild.startDevServer();
    try {
      for (const { query, label, id } of [
        { query: "wxlb", label: "无序列表", id: "bulletList" },
        { query: "yxlb", label: "有序列表", id: "orderedList" },
        { query: "rwlb", label: "任务列表", id: "taskList" },
        { query: "hndm", label: "行内代码", id: "inlineCode" },
        { query: "p", label: "文本", id: "paragraph" },
      ]) {
        await page.goto(`http://127.0.0.1:${port}`);
        const host = page.locator(
          table ? "#table-insert-fixture .semlo-editor-prose" : "#search-recent-root-fixture .semlo-editor-prose",
        );
        await host.locator("p").first().click();
        await page.keyboard.type(`/${query}`);
        await page.keyboard.press("Enter");
        const target = table ? host.locator("td").nth(1).locator("p") : host.locator(":scope > p").last();
        await target.click();
        await page.keyboard.type("/");
        const menu = page.getByRole("listbox", { name: "插入内容" });
        const recent = menu.getByLabel("最近使用").locator(`[data-command="${id}"]`);
        await expect(recent, `${query} table=${table}`).toHaveText(label);
        await recent.click();
        if (id === "inlineCode") {
          await page.keyboard.type("x");
          await expect(host.locator("code").last()).toHaveText("x");
        } else if (id === "paragraph") {
          await expect(target).toHaveText("");
        } else {
          const list =
            id === "orderedList" ? "ol" : id === "taskList" ? 'ul[data-type="taskList"]' : "ul:not([data-type])";
          await expect(host.locator(`${list} li`), `${query} table=${table}`).toHaveCount(2);
        }
      }
      if (table) {
        await page.goto(`http://127.0.0.1:${port}`);
        await page.evaluate(() =>
          localStorage.setItem("semlo-editor.recent-commands.v1", JSON.stringify(["table", "details", "callout"])),
        );
        await page.locator("#table-insert-fixture td p").first().click();
        await page.keyboard.type("/");
        const recent = page.getByRole("listbox", { name: "插入内容" }).getByLabel("最近使用");
        await expect(recent.locator('[data-command="callout"]')).toHaveCount(1);
        await expect(recent.locator('[data-command="table"], [data-command="details"]')).toHaveCount(0);
      }
    } finally {
      await server.close();
    }
  }
});
