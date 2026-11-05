import { createRsbuild } from "@rsbuild/core";
import { test, expect } from "@rstest/playwright";
declare global {
  interface Window {
    slashCandidate: {
      mount(name: string): Promise<void>;
      mountSecond(): void;
      otherHtml(): string;
      destroySecond(): void;
      installHook(): void;
      installBoldMutation(): void;
      installAppendMutation(): void;
      installAppendOnUndo(): void;
      installUndoVeto(): void;
      removeUndoVeto(): void;
      armBefore(mode: string): void;
      runUndo(): string;
      beforeResult(): string;
      isDestroyed(): boolean;
      historyDepth(): number;
      historyBurst(count: number): void;
      reorderHistoryPlugin(): void;
      breakHistory(): void;
      setCaret(pos: number): void;
      debug(): unknown;
      html(): string;
      snapshot(): string;
      changes(): string[];
      seen(): string[];
      hostInsert(value: string, pos: number): void;
      hostInsertBoundary(value: string, pos: number): void;
      setContent(value: string): void;
      destroy(): void;
    };
  }
}
const setup = async () => {
  const r = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/insertion/slash-undo-candidate-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: { alias: { "@semlo-editor/core$": "./packages/core/src/index.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  return r.startDevServer();
};
for (const framework of ["core", "react", "vue", "solid"])
  test(`${framework}: actual menu reopens after undo without snapshot divergence`, async ({ page }) => {
    const { port, server } = await setup();
    try {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate((f) => window.slashCandidate.mount(f), framework);
      await page.locator("#candidate-host .semlo-editor-prose p").first().click();
      await page.keyboard.type("/p");
      await page.keyboard.press("Enter");
      await page.keyboard.type("abc");
      await page.keyboard.press("Meta+z");
      await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>/</p><p>乙</p>");
      await expect(page.locator(".semlo-editor-slash-menu:visible")).toHaveCount(1);
      expect(await page.evaluate(() => window.slashCandidate.snapshot())).toBe(
        await page.evaluate(() => window.slashCandidate.html()),
      );
    } finally {
      await page.evaluate(() => window.slashCandidate?.destroy());
      await server.close();
    }
  });
test("late host hook transforms ordinary input and readable APIs agree", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.evaluate(() => window.slashCandidate.installHook());
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/q");
    expect(await page.evaluate(() => window.slashCandidate.html())).toBe("<p>/Q</p><p>乙</p>");
    expect(await page.evaluate(() => window.slashCandidate.seen())).toContain("q");
    expect(await page.evaluate(() => window.slashCandidate.snapshot())).toBe(
      await page.evaluate(() => window.slashCandidate.html()),
    );
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});
test("controlled echo and host insertion preserve ordinary text", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/p");
    await page.evaluate(() => {
      const html = window.slashCandidate.snapshot();
      window.slashCandidate.setContent(html);
      window.slashCandidate.hostInsert("a", 3);
    });
    expect(await page.evaluate(() => window.slashCandidate.html())).toContain("a");
    expect(await page.evaluate(() => window.slashCandidate.snapshot())).toBe(
      await page.evaluate(() => window.slashCandidate.html()),
    );
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});
test("host-inserted text in query survives command undo", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/");
    await page.evaluate(() => window.slashCandidate.hostInsertBoundary("p", 2));
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>/p</p><p>乙</p>");
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
    await page.keyboard.press("Meta+z");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>/p</p><p>乙</p>");
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});

test("ordinary undo keeps surrounding document text", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("正文");
    await page.keyboard.press("Meta+z");
    expect(await page.evaluate(() => window.slashCandidate.html())).toContain("乙");
    expect(await page.evaluate(() => window.slashCandidate.snapshot())).toBe(
      await page.evaluate(() => window.slashCandidate.html()),
    );
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});

test("host mutation to default text transaction remains after undo", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/");
    await page.evaluate(() => {
      window.slashCandidate.breakHistory();
      window.slashCandidate.installBoldMutation();
    });
    await page.keyboard.type("p");
    await expect
      .poll(() => page.evaluate(() => window.slashCandidate.html()))
      .toBe("<p>/<strong>p</strong></p><p>乙</p>");
    await page.evaluate(() => window.slashCandidate.breakHistory());
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toContain("abc");
    await page.keyboard.press("Meta+z");
    await expect
      .poll(() => page.evaluate(() => window.slashCandidate.html()))
      .toBe("<p>/<strong>p</strong></p><p>乙</p>");
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});
test("redo after restoring empty slash recovers committed text", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
    await page.keyboard.press("Meta+z");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>/</p><p>乙</p>");
    await page.locator("#candidate-host").getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});

test("host appended mark on query remains after command undo", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/");
    await page.evaluate(() => {
      window.slashCandidate.breakHistory();
      window.slashCandidate.installAppendMutation();
    });
    await page.keyboard.type("p");
    await expect
      .poll(() => page.evaluate(() => window.slashCandidate.html()))
      .toBe("<p>/<strong>p</strong></p><p>乙</p>");
    await page.evaluate(() => window.slashCandidate.breakHistory());
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toContain("abc");
    await page.keyboard.press("Meta+z");
    await expect
      .poll(() => page.evaluate(() => window.slashCandidate.html()))
      .toBe("<p>/<strong>p</strong></p><p>乙</p>");
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});
test("second undo and toolbar redo match observed reference", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
    await page.keyboard.press("Meta+z");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>/</p><p>乙</p>");
    await page.keyboard.press("Meta+z");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>/</p><p>乙</p>");
    await page.locator("#candidate-host").getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});
test("programmatic slash is preserved when subsequent typed query is undone", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.evaluate(() => window.slashCandidate.hostInsertBoundary("/", 1));
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>/</p><p>乙</p>");
    await page.evaluate(() => window.slashCandidate.setCaret(2));
    await page.keyboard.type("p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
    await page.keyboard.press("Meta+z");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>/</p><p>乙</p>");
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});

test("undo in first editor does not affect second editor", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(async () => {
      await window.slashCandidate.mount("core");
      window.slashCandidate.mountSecond();
    });
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
    await page.keyboard.press("Meta+z");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>/</p><p>乙</p>");
    expect(await page.evaluate(() => window.slashCandidate.otherHtml())).toBe("<p>宿主</p>");
  } finally {
    await page.evaluate(() => {
      window.slashCandidate?.destroySecond();
      window.slashCandidate?.destroy();
    });
    await server.close();
  }
});

test("late host history append is preserved relative to baseline", async ({ page }) => {
  const { port, server } = await setup();
  try {
    for (const baseline of [true, false]) {
      await page.goto(`http://127.0.0.1:${port}${baseline ? "/?baseline=1" : ""}`);
      await page.evaluate(() => window.slashCandidate.mount("core"));
      await page.locator("#candidate-host .semlo-editor-prose p").first().click();
      await page.keyboard.type("/p");
      await page.evaluate(() => {
        window.slashCandidate.breakHistory();
        window.slashCandidate.installAppendOnUndo();
      });
      await page.keyboard.press("Enter");
      await page.keyboard.type("abc");
      await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
      await page.keyboard.press("Meta+z");
      await page.waitForTimeout(150);
      expect(await page.evaluate(() => window.slashCandidate.html()), baseline ? "baseline" : "candidate").toBe(
        "<p>/p甲</p><p>乙</p>",
      );
      await page.evaluate(() => window.slashCandidate.destroy());
    }
  } finally {
    await server.close();
  }
});

test("host rejects undo without deleting content or history", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
    await page.evaluate(() => window.slashCandidate.installUndoVeto());
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
    await page.evaluate(() => window.slashCandidate.removeUndoVeto());
    await page.keyboard.press("Meta+z");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>/</p><p>乙</p>");
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});
test("beforeTransaction reentrant replacement follows baseline guard contract", async ({ page }) => {
  const { port, server } = await setup();
  try {
    for (const baseline of [true, false]) {
      await page.goto(`http://127.0.0.1:${port}${baseline ? "/?baseline=1" : ""}`);
      await page.evaluate(() => window.slashCandidate.mount("core"));
      await page.locator("#candidate-host .semlo-editor-prose p").first().click();
      await page.keyboard.type("/p");
      await page.evaluate(() => window.slashCandidate.breakHistory());
      await page.keyboard.press("Enter");
      await page.keyboard.type("abc");
      await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
      const result = await page.evaluate(() => {
        window.slashCandidate.armBefore("replace");
        return window.slashCandidate.runUndo();
      });
      expect(result).toBe("ok");
      expect(await page.evaluate(() => window.slashCandidate.beforeResult())).toBe("ReentrantTransactionError");
      expect(await page.evaluate(() => window.slashCandidate.html())).toBe(
        baseline ? "<p>/p</p><p>乙</p>" : "<p>/</p><p>乙</p>",
      );
      await page.evaluate(() => window.slashCandidate.destroy());
    }
  } finally {
    await server.close();
  }
});

test("beforeTransaction synchronous destroy aborts safely", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
    const result = await page.evaluate(() => {
      window.slashCandidate.armBefore("destroy");
      return window.slashCandidate.runUndo();
    });
    expect(result).toBe("TransactionAbortedError");
    expect(await page.evaluate(() => window.slashCandidate.isDestroyed())).toBe(true);
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});

test("empty command undo sequence and toolbar redo match observed reference", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/p");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p></p><p>乙</p>");
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Meta+z");
      await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>/</p><p>乙</p>");
    }
    await page.locator("#candidate-host").getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p></p><p>乙</p>");
    await expect(page.locator("#candidate-host").getByRole("button", { name: "重做", exact: true })).toBeDisabled();
    await page.keyboard.press("Meta+Shift+z");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p></p><p>乙</p>");
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});

test("history capacity changes do not erase unrelated host content", async ({ page }) => {
  const { port, server } = await setup();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("/p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
    await page.evaluate(() => window.slashCandidate.historyBurst(130));
    expect(await page.evaluate(() => window.slashCandidate.historyDepth())).toBeLessThan(130);
    expect(await page.evaluate(() => window.slashCandidate.html())).toBe(`<p>abc</p><p>${"x".repeat(130)}乙</p>`);
    await page.keyboard.press("Meta+z");
    await expect
      .poll(() => page.evaluate(() => window.slashCandidate.html()))
      .toBe(`<p>abc</p><p>${"x".repeat(129)}乙</p>`);
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});

test("host plugin reordering retains ordinary typing and undo", async ({ page }) => {
  const { port, server } = await setup();
  try {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(() => window.slashCandidate.mount("core"));
    await page.evaluate(() => window.slashCandidate.reorderHistoryPlugin());
    await page.locator("#candidate-host .semlo-editor-prose p").first().click();
    await page.keyboard.type("abc");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p>abc</p><p>乙</p>");
    await page.keyboard.press("Meta+z");
    await expect.poll(() => page.evaluate(() => window.slashCandidate.html())).toBe("<p></p><p>乙</p>");
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => window.slashCandidate?.destroy());
    await server.close();
  }
});
