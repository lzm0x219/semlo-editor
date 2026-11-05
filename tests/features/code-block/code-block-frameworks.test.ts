import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    oldIndentCallbacks?: Array<() => void>;
    oldIndentErrors?: string[];
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} cancels pending code indentation on unmount and leaves the next editor usable`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
    const oldText = "class Old {\nvoid Run() {\nOldMarker();\n}\n}\n".repeat(300);
    await page.evaluate((text) => {
      window.__semloRequireFixture("dynamicEditor").controller.setContent({
        type: "doc",
        content: [{ type: "codeBlock", attrs: { language: "csharp" }, content: [{ type: "text", text }] }],
      });
    }, oldText);
    const host = page.locator("#dynamic-editor");
    const card = host.locator(".semlo-editor-code-card");
    await card.hover();
    await card.getByRole("button", { name: "代码块更多设置" }).click();
    await expect(page.getByRole("menuitem", { name: "自动缩进" })).toBeVisible();

    const afterRemount = await page.evaluate(async (name) => {
      const previous = window.__semloRequireFixture("dynamicEditor");
      const beforeAction = previous.controller.editor.state.doc.firstChild?.textContent;
      const originalSetTimeout = window.setTimeout;
      const pending: Array<() => void> = [];
      let capturing = true;
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (capturing && delay === 0 && typeof handler === "function") {
          pending.push(() => handler(...args));
          return -pending.length;
        }
        return Reflect.apply(originalSetTimeout, window, [handler, delay, ...args]) as number;
      }) as typeof window.setTimeout;
      try {
        const action = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
          item.textContent?.includes("自动缩进"),
        );
        if (!action) throw new Error("The automatic indentation action is missing");
        action.click();
      } finally {
        capturing = false;
        window.setTimeout = originalSetTimeout;
      }
      if (!pending.length) throw new Error("Expected a pending asynchronous indentation task");
      const beforeUnmount = previous.controller.editor.state.doc.firstChild?.textContent;
      const pendingFeedback = document.querySelector(".semlo-editor-code-feedback");
      const beforeUnmountFeedback = pendingFeedback?.textContent ?? null;
      const pendingRole = pendingFeedback?.getAttribute("role") ?? null;
      const pendingLive = pendingFeedback?.getAttribute("aria-live") ?? null;
      previous.destroy();
      await window.__semloRequireFixture("mountDynamicEditor").bind(window)(name);
      const next = window.__semloRequireFixture("dynamicEditor");
      const text = "function fresh(){\ncall();\n}";
      next.controller.setContent({
        type: "doc",
        content: [{ type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text }] }],
      });
      window.oldIndentCallbacks = pending;
      window.oldIndentErrors = previous.errors;
      return {
        scheduled: pending.length,
        unchangedBeforeUnmount: beforeUnmount === beforeAction,
        beforeUnmountFeedback,
        pendingRole,
        pendingLive,
        destroyed: previous.controller.editor.isDestroyed,
        oldErrors: previous.errors,
        newErrors: next.errors,
        text: next.controller.editor.state.doc.firstChild?.textContent,
        feedback: document.querySelector(".semlo-editor-code-feedback")?.textContent ?? null,
        oldMenus: document.querySelectorAll(".semlo-editor-code-settings-menu").length,
        hosts: document.querySelectorAll("#dynamic-editor").length,
      };
    }, framework);

    expect(afterRemount.scheduled).toBeGreaterThan(0);
    expect(afterRemount.unchangedBeforeUnmount).toBe(true);
    expect(afterRemount.beforeUnmountFeedback).toBe("正在自动缩进…");
    expect(afterRemount.pendingRole).toBe("status");
    expect(afterRemount.pendingLive).toBe("polite");
    expect(afterRemount.destroyed).toBe(true);
    expect(afterRemount.oldErrors).toEqual([]);
    expect(afterRemount.newErrors).toEqual([]);
    expect(afterRemount.text).toBe("function fresh(){\ncall();\n}");
    expect(afterRemount.feedback).toBeNull();
    expect(afterRemount.oldMenus).toBe(0);
    expect(afterRemount.hosts).toBe(1);

    const nextHost = page.locator("#dynamic-editor");
    const nextCard = nextHost.locator(".semlo-editor-code-card");
    await nextCard.hover();
    await nextCard.getByRole("button", { name: "代码块更多设置" }).click();
    await page.getByRole("menuitem", { name: "自动缩进" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__semloRequireFixture("dynamicEditor").controller.editor.state.doc.firstChild?.textContent,
        ),
      )
      .toBe("function fresh(){\n  call();\n}");
    await expect(page.getByText("自动缩进成功", { exact: true })).toBeVisible();

    // Resume the old task after the replacement has its own success feedback.
    const afterOldTask = await page.evaluate(async () => {
      for (const callback of window.__semloRequireFixture("oldIndentCallbacks")) callback();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        oldErrors: window.__semloRequireFixture("oldIndentErrors"),
        newErrors: window.__semloRequireFixture("dynamicEditor").errors,
        text: window.__semloRequireFixture("dynamicEditor").controller.editor.state.doc.firstChild?.textContent,
        feedback: document.querySelector(".semlo-editor-code-feedback")?.textContent ?? null,
      };
    });
    expect(afterOldTask.oldErrors).toEqual([]);
    expect(afterOldTask.newErrors).toEqual([]);
    expect(afterOldTask.text).toBe("function fresh(){\n  call();\n}");
    expect(afterOldTask.feedback).toBe("自动缩进成功");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.commands.undo()),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => window.__semloRequireFixture("dynamicEditor").controller.editor.state.doc.firstChild?.textContent,
      ),
    ).toBe("function fresh(){\ncall();\n}");
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
    await expect(page.locator(".semlo-editor-code-feedback")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
}
