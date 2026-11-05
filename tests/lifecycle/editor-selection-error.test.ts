import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

test("a host error during DOM selection synchronization stops the toolbar command", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/lifecycle/editor-selection-error-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-selection-error-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const result = await page.evaluate(() => {
      const { controller, element } = window.selectionErrorFixture;
      const editor = controller.editor;
      editor.commands.focus();
      editor.commands.setTextSelection(1);
      let errors = 0;
      let invoked = 0;
      window.addEventListener("error", () => errors++);
      editor.on("beforeTransaction", ({ transaction }) => {
        if (transaction.selectionSet && !invoked++) throw new Error("host failure");
      });
      const text = element.querySelector(".semlo-editor-prose p")!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 2);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.querySelector<HTMLButtonElement>('button[aria-label="加粗"]')!.click();
      return { errors, invoked, bold: editor.isActive("bold") };
    });
    expect(result.invoked).toBeGreaterThan(0);
    expect(result.errors).toBe(1);
    expect(result.bold).toBe(false);
  } finally {
    await server.close();
  }
});

test("link dialog ignores Escape during composition", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/lifecycle/editor-selection-error-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-selection-error-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.getByRole("button", { name: "链接", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "插入链接" });
    const input = panel.getByLabel("链接", { exact: true });
    await input.focus();
    for (const mode of ["isComposing", "keyCode"]) {
      await input.evaluate(
        (node, mode) =>
          node.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              isComposing: mode === "isComposing",
              keyCode: mode === "keyCode" ? 229 : 0,
              bubbles: true,
            }),
          ),
        mode,
      );
      await expect(panel).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  } finally {
    await server.close();
  }
});
