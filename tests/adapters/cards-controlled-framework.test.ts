import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import type { SnapshotFramework } from "../fixtures/contracts/nested-snapshot-framework-fixture";

let origin: string;
let closeServer: () => Promise<void>;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/contracts/nested-snapshot-framework-fixture.ts" },
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
test.beforeEach(async ({ page }) => installFixtureGuards(page));

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: controlled echoes preserve date picker and fold edits`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T11:24:00"));
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.__semloRequireFixture("mountNestedSnapshotFixture")(name);
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      fixture.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { date: "2026-11-03", time: "12:00" } }] },
          {
            type: "details",
            attrs: { open: true },
            content: [
              { type: "detailsSummary", content: [{ type: "text", text: "标题" }] },
              { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] },
            ],
          },
        ],
      });
      await fixture.settle();
      fixture.setEcho(true);
    }, framework);
    const date = page.getByRole("button", { name: "日期：2026-11-03 12:00" });
    await date.click();
    const picker = page.getByRole("dialog", { name: "选择日期" });
    await picker.getByRole("button", { name: "选择时刻" }).click();
    await picker.getByRole("option", { name: "12:30", exact: true }).click();
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").settle());
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: "选择时刻" })).toHaveText("12:30");
    await expect(page.getByRole("button", { name: "日期：2026-11-03 12:30" })).toBeVisible();
    const paragraph = page.locator('[data-type="detailsContent"] p');
    await paragraph.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText("追加");
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").settle());
    await expect(paragraph).toHaveText("正文追加");
    const result = await page.evaluate(() => ({
      changes: window.__semloRequireFixture("nestedSnapshotFixture").changes.length,
      errors: window.__semloRequireFixture("nestedSnapshotFixture").errors,
      json: window.__semloRequireFixture("nestedSnapshotFixture").controller.getSnapshot().json,
    }));
    expect(result.changes).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.json.content?.[0].content?.[0].attrs?.time).toBe("12:30");
    expect(result.json.content?.[1].content?.[1].content?.[0].content?.[0].text).toBe("正文追加");
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: replacing an open date document does not retain stale date state`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.__semloRequireFixture("mountNestedSnapshotFixture")(name);
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      fixture.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { date: "2026-11-03", time: "12:00" } }] },
        ],
      });
      await fixture.settle();
    }, framework);
    await page.getByRole("button", { name: "日期：2026-11-03 12:00" }).click();
    await expect(page.getByRole("dialog", { name: "选择日期" })).toBeVisible();
    await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      fixture.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { date: "2027-02-04", time: "09:15" } }] },
        ],
      });
      await fixture.settle();
    });
    const replacement = page.getByRole("button", { name: "日期：2027-02-04 09:15" });
    await expect(replacement).toBeVisible();
    await page.mouse.click(10, 10);
    await replacement.click();
    const picker = page.getByRole("dialog", { name: "选择日期" });
    await expect(picker.getByRole("button", { name: "选择年份" })).toHaveText("2027年");
    await expect(picker.getByRole("button", { name: "选择月份" })).toHaveText("2月");
    await expect(picker.getByRole("button", { name: "选择时刻" })).toHaveText("09:15");
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").changes.length)).toBe(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").errors)).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: a controlled calendar replacement closes the stale event editor`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.__semloRequireFixture("mountNestedSnapshotFixture")(name);
      await window.__semloRequireFixture("nestedSnapshotFixture").settle();
    }, framework);
    await page.getByRole("button", { name: "日程：原始日程" }).first().click();
    const dialog = page.getByRole("dialog", { name: "编辑日程" });
    await expect(dialog).toBeVisible();
    await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      const json = fixture.controller.getSnapshot().json;
      json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0].title = "宿主更新";
      fixture.setContent(json);
      await fixture.settle();
    });
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "日程：宿主更新" }).first().click();
    await expect(page.getByRole("dialog", { name: "编辑日程" }).getByLabel("日程标题")).toHaveValue("宿主更新");
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").changes.length)).toBe(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").errors)).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: replacing a calendar discards an uncommitted date draft`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.mountNestedSnapshotFixture!(name);
      await window.nestedSnapshotFixture!.settle();
    }, framework);
    await page.getByRole("button", { name: "日程：原始日程" }).first().click();
    const dialog = page.getByRole("dialog", { name: "编辑日程" });
    const start = dialog.getByLabel("开始日期");
    await start.click();
    await start.fill("2026-11-12");
    await expect(page.getByRole("dialog", { name: "选择日程日期范围" })).toBeVisible();
    await page.evaluate(async () => {
      const fixture = window.nestedSnapshotFixture!;
      const json = fixture.controller.getSnapshot().json;
      const event = json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0];
      event.title = "宿主更新";
      event.start = "2026-11-07";
      event.end = "2026-11-07";
      fixture.setContent(json);
      await fixture.settle();
    });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "选择日程日期范围" })).toHaveCount(0);
    await page.getByRole("button", { name: "日程：宿主更新" }).first().click();
    const updated = page.getByRole("dialog", { name: "编辑日程" });
    await expect(updated.getByLabel("开始日期")).toHaveValue("2026-11-07");
    await expect(updated.getByLabel("结束日期")).toHaveValue("2026-11-07");
    expect(await page.evaluate(() => window.nestedSnapshotFixture!.changes.length)).toBe(0);
    expect(await page.evaluate(() => window.nestedSnapshotFixture!.errors)).toEqual([]);
    await page.evaluate(() => window.nestedSnapshotFixture!.destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: replacing surrounding text cannot commit a stale calendar date draft`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.mountNestedSnapshotFixture!(name);
      await window.nestedSnapshotFixture!.settle();
    }, framework);
    await page.getByRole("button", { name: "日程：原始日程" }).first().click();
    const dialog = page.getByRole("dialog", { name: "编辑日程" });
    const start = dialog.getByLabel("开始日期");
    await start.click();
    await start.fill("2026-11-12");
    await page.evaluate(async () => {
      const fixture = window.nestedSnapshotFixture!;
      const json = fixture.controller.getSnapshot().json;
      json.content![0].content![0].text = "宿主更新正文";
      fixture.setContent(json);
      await fixture.settle();
    });
    await page.mouse.click(10, 10);
    await page.evaluate(() => window.nestedSnapshotFixture!.settle());
    const result = await page.evaluate(() => {
      const fixture = window.nestedSnapshotFixture!;
      const json = fixture.controller.getSnapshot().json;
      return {
        paragraph: json.content![0].content![0].text,
        event: json.content!.find((node) => node.type === "semloEditorCalendar")!.attrs!.events[0],
        changes: fixture.changes.length,
        errors: fixture.errors,
      };
    });
    expect(result.paragraph).toBe("宿主更新正文");
    expect(result.event.start).toBe("2026-11-05");
    expect(result.event.end).toBe("2026-11-05");
    expect(result.changes).toBe(0);
    expect(result.errors).toEqual([]);
    await page.evaluate(() => window.nestedSnapshotFixture!.destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: an equal controlled echo preserves an uncommitted calendar date draft`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.mountNestedSnapshotFixture!(name);
      await window.nestedSnapshotFixture!.settle();
    }, framework);
    await page.getByRole("button", { name: "日程：原始日程" }).first().click();
    const dialog = page.getByRole("dialog", { name: "编辑日程" });
    const start = dialog.getByLabel("开始日期");
    await start.click();
    await start.fill("2026-11-12");
    await expect(start).toBeFocused();
    await page.evaluate(async () => {
      const fixture = window.nestedSnapshotFixture!;
      fixture.setContent(fixture.controller.getSnapshot().json);
      await fixture.settle();
    });
    await expect(dialog).toBeVisible();
    await expect(start).toBeFocused();
    await expect(start).toHaveValue("2026-11-12");
    await start.press("Enter");
    const end = dialog.getByLabel("结束日期");
    await expect(end).toBeFocused();
    await end.fill("2026-11-13");
    await end.press("Enter");
    await expect(start).toHaveValue("2026-11-12");
    await expect(end).toHaveValue("2026-11-13");
    const result = await page.evaluate(() => {
      const fixture = window.nestedSnapshotFixture!;
      const calendar = fixture.controller
        .getSnapshot()
        .json.content!.find((node) => node.type === "semloEditorCalendar")!;
      return { event: calendar.attrs!.events[0], changes: fixture.changes.length, errors: fixture.errors };
    });
    expect(result.event.start).toBe("2026-11-12");
    expect(result.event.end).toBe("2026-11-13");
    expect(result.changes).toBe(1);
    expect(result.errors).toEqual([]);
    await page.evaluate(() => window.nestedSnapshotFixture!.destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: explicit equal date-node replacement closes the old picker`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.mountNestedSnapshotFixture!(name);
      const fixture = window.nestedSnapshotFixture!;
      fixture.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "semloEditorDate", attrs: { date: "2026-11-03", time: "12:00" } }] },
        ],
      });
      await fixture.settle();
      fixture.setEcho(true);
    }, framework);
    const date = page.getByRole("button", { name: "日期：2026-11-03 12:00" });
    await date.click();
    const picker = page.getByRole("dialog", { name: "选择日期" });
    await expect(picker).toBeVisible();
    await page.evaluate(async () => {
      const fixture = window.nestedSnapshotFixture!;
      const editor = fixture.controller.editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "semloEditorDate") position = pos;
      });
      const node = editor.state.doc.nodeAt(position)!;
      editor.view.dispatch(
        editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
      );
      await fixture.settle();
    });
    await expect(picker).toHaveCount(0);
    await expect(date).toBeVisible();
    expect(await page.evaluate(() => window.nestedSnapshotFixture!.errors)).toEqual([]);
    await page.evaluate(() => window.nestedSnapshotFixture!.destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  for (const replace of [false, true]) {
    test(`${framework}: ${replace ? "replacing a formula discards its stale draft" : "an equal echo preserves a formula draft"}`, async ({
      page,
    }) => {
      await page.goto(origin);
      await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
      await page.evaluate(async (name) => {
        await window.__semloRequireFixture("mountNestedSnapshotFixture")(name);
        const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
        fixture.setContent({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "semloEditorFormula", attrs: { id: "formula", latex: "x" } }] },
          ],
        });
        await fixture.settle();
        fixture.setEcho(true);
      }, framework);
      await page.getByRole("button", { name: "公式：x" }).click();
      const panel = page.getByRole("dialog", { name: "编辑公式" });
      await panel.getByLabel("TeX 公式").fill("x+1");
      await page.evaluate(async (replace) => {
        const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
        const json = fixture.controller.getSnapshot().json;
        if (replace) json.content![0].content![0].attrs!.latex = "z";
        fixture.setContent(json);
        await fixture.settle();
      }, replace);
      if (replace) {
        await expect(panel).toHaveCount(0);
        await expect(page.getByRole("button", { name: "公式：z" })).toBeVisible();
      } else {
        await expect(panel.getByLabel("TeX 公式")).toHaveValue("x+1");
        await panel.getByRole("button", { name: "确定" }).click();
        await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").settle());
        await expect(page.getByRole("button", { name: "公式：x+1" })).toBeVisible();
      }
      expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").errors)).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
    });
  }
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: explicit equal formula-node replacement closes the old draft`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.__semloRequireFixture("mountNestedSnapshotFixture")(name);
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      fixture.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "semloEditorFormula", attrs: { id: "formula", latex: "x" } }] },
        ],
      });
      await fixture.settle();
      fixture.setEcho(true);
    }, framework);
    await page.getByRole("button", { name: "公式：x" }).click();
    const panel = page.getByRole("dialog", { name: "编辑公式" });
    await panel.getByLabel("TeX 公式").fill("x+1");
    await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      const editor = fixture.controller.editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "semloEditorFormula") position = pos;
      });
      const node = editor.state.doc.nodeAt(position)!;
      editor.view.dispatch(
        editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
      );
      await fixture.settle();
    });
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "公式：x", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").errors)).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: controlled status echo stays editable until explicit equal-node replacement`, async ({
    page,
  }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.__semloRequireFixture("mountNestedSnapshotFixture")(name);
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      fixture.setContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "semloEditorStatus", attrs: { label: "待办", color: 0 } }] }],
      });
      await fixture.settle();
      fixture.setEcho(true);
    }, framework);
    await page.getByRole("button", { name: "状态：待办" }).click();
    const panel = page.getByRole("dialog", { name: "编辑状态" });
    await panel.getByLabel("状态文字").fill("进行中");
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").settle());
    await expect(panel.getByLabel("状态文字")).toHaveValue("进行中");
    await expect(page.getByRole("button", { name: "状态：进行中" })).toBeVisible();
    await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      const editor = fixture.controller.editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "semloEditorStatus") position = pos;
      });
      const node = editor.state.doc.nodeAt(position)!;
      editor.view.dispatch(
        editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
      );
      await fixture.settle();
    });
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "状态：进行中" })).toBeVisible();
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").errors)).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: replacing a block formula discards its stale draft`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.__semloRequireFixture("mountNestedSnapshotFixture")(name);
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      fixture.setContent({
        type: "doc",
        content: [
          { type: "semloEditorBlockFormula", attrs: { id: "block-formula", latex: "x" } },
          { type: "paragraph" },
        ],
      });
      await fixture.settle();
      fixture.setEcho(true);
    }, framework);
    await page.getByRole("button", { name: "公式：x", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "编辑公式" });
    await panel.getByLabel("TeX 公式").fill("x+1");
    await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      const json = fixture.controller.getSnapshot().json;
      json.content![0].attrs!.latex = "z";
      fixture.setContent(json);
      await fixture.settle();
    });
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "公式：z", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").errors)).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: candidate Escape commits formula through controlled echo`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.__semloRequireFixture("mountNestedSnapshotFixture")(name);
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      fixture.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "semloEditorFormula", attrs: { id: "formula", latex: "x" } }] },
        ],
      });
      await fixture.settle();
      fixture.setEcho(true);
    }, framework);
    await page.getByRole("button", { name: "公式：x", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "编辑公式" });
    const input = panel.getByLabel("TeX 公式");
    await input.fill("x+1");
    await input.press("Escape");
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").settle());
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "公式：x+1", exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          window.__semloRequireFixture("nestedSnapshotFixture").controller.getSnapshot().json.content![0].content![0]
            .attrs!.latex,
      ),
    ).toBe("x+1");
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").errors)).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
  });
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly SnapshotFramework[]) {
  test(`${framework}: candidate outside click commits formula through controlled echo`, async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountNestedSnapshotFixture === "function");
    await page.evaluate(async (name) => {
      await window.__semloRequireFixture("mountNestedSnapshotFixture")(name);
      const fixture = window.__semloRequireFixture("nestedSnapshotFixture");
      fixture.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "semloEditorFormula", attrs: { id: "formula", latex: "x" } }] },
        ],
      });
      await fixture.settle();
      fixture.setEcho(true);
      const b = document.createElement("button");
      b.id = "external-focus";
      b.textContent = "外部按钮";
      document.body.prepend(b);
    }, framework);
    await page.getByRole("button", { name: "公式：x", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "编辑公式" });
    await panel.getByLabel("TeX 公式").fill("x+1");
    await page.locator("#external-focus").click();
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").settle());
    await expect(panel).toHaveCount(0);
    await expect(page.locator("#external-focus")).toBeFocused();
    expect(
      await page.evaluate(
        () =>
          window.__semloRequireFixture("nestedSnapshotFixture").controller.getSnapshot().json.content![0].content![0]
            .attrs!.latex,
      ),
    ).toBe("x+1");
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").errors)).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("nestedSnapshotFixture").destroy());
  });
}
