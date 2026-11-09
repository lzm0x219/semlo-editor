import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/references/link-command-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/references/link-command-fixture.ts", {
    publicDir: false,
  }));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.linkCommandFixture));
});

type Entry = "main" | "custom-floating" | "shortcut" | "custom" | "api";
async function openLink(page: Page, entry: Entry) {
  const host = page.locator("#link-command-A");
  if (entry === "main") {
    await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "链接", exact: true }).click();
  } else if (entry === "custom-floating") {
    await host
      .getByRole("toolbar", { name: "选中文字工具" })
      .getByRole("button", { name: "链接", exact: true })
      .click();
  } else if (entry === "shortcut") {
    await host.locator(".semlo-editor-prose").focus();
    await page.keyboard.press("ControlOrMeta+k");
  } else if (entry === "custom") {
    await host
      .getByRole("toolbar", { name: "自定义工具栏" })
      .getByRole("button", { name: "链接", exact: true })
      .click();
  } else expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(true);
}

async function applyLink(page: Page, entry: Entry, href: string, text: string) {
  if (entry === "api")
    return page.evaluate(({ href, text }) => window.linkCommandFixture.apply("A", href, text), { href, text });
  if (entry === "custom") {
    const form = page.getByRole("form", { name: "链接设置" });
    await form.getByRole("textbox", { name: "链接文本" }).fill(text);
    await form.getByRole("textbox", { name: "链接地址" }).fill(href);
    await form.getByRole("button", { name: "应用链接" }).click();
  } else {
    const form = page.getByRole("dialog", { name: "插入链接" });
    await form.getByLabel("文本").fill(text);
    await form.getByLabel("链接", { exact: true }).fill(href);
    await form.getByRole("button", { name: "确定" }).click();
  }
}

for (const mode of ["default", "custom", "custom-floating"] as const) {
  for (const reverse of [false, true]) {
    test(`${mode} ${reverse ? "反向" : "正向"}跨段落选区禁用链接并保留内容、选区和历史`, async ({ page }) => {
      const content = "<p><strong>alpha</strong></p><p><em>beta</em></p><p>tail</p>";
      await page.evaluate(({ content, mode }) => window.linkCommandFixture.mount("A", content, mode), {
        content,
        mode,
      });
      const host = page.locator("#link-command-A");
      const prose = host.locator(".semlo-editor-prose");
      const original = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
      await prose.locator("p").last().click();
      await page.keyboard.press("End");
      await page.keyboard.type("!");
      await page.evaluate((reverse) => window.linkCommandFixture.select("A", "alpha", 1, 9, reverse), reverse);
      const before = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
      const selection = await page.evaluate(() => window.linkCommandFixture.selection("A"));
      expect(selection).toEqual({ text: "lpha|be", backward: reverse, empty: false });
      expect(await page.evaluate(() => window.linkCommandFixture.state("A"))).toEqual({
        active: false,
        enabled: false,
      });
      await expect(host.getByRole("button", { name: "链接", exact: true }).first()).toBeDisabled();
      if (mode === "custom-floating")
        await expect(
          host.getByRole("toolbar", { name: "选中文字工具" }).getByRole("button", { name: "链接", exact: true }),
        ).toBeDisabled();
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.getByRole("dialog", { name: "插入链接" })).toHaveCount(0);
      expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(false);
      expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(before);
      expect(await page.evaluate(() => window.linkCommandFixture.selection("A"))).toEqual(selection);
      expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
      expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(original);
      expect(await page.evaluate(() => window.linkCommandFixture.redo("A"))).toBe(true);
      expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(before);
      await page.evaluate(() => window.linkCommandFixture.destroy("A"));
    });
  }
}

test("窄屏跨段落链接禁用，收回单段选区后可从更多菜单打开", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(() => {
    window.linkCommandFixture.mount("A", "<p><strong>alpha</strong></p><p>beta</p>", "default");
    window.linkCommandFixture.select("A", "alpha", 1, 9);
  });
  const host = page.locator("#link-command-A");
  await host.getByRole("button", { name: "更多", exact: true }).click();
  const link = page.getByRole("toolbar", { name: "更多工具" }).getByRole("button", { name: "链接", exact: true });
  await expect(link).toBeVisible();
  await expect(link).toBeDisabled();
  await page.evaluate(() => window.linkCommandFixture.select("A", "alpha", 0, 5));
  await expect(link).toBeEnabled();
  await link.click();
  await expect(page.getByRole("dialog", { name: "插入链接" }).getByLabel("文本")).toHaveValue("alpha");
  await page.getByRole("dialog", { name: "插入链接" }).getByRole("button", { name: "取消" }).click();
  await expect(host.locator(".semlo-editor-prose strong")).toHaveText("alpha");
  await expect(host.locator(".semlo-editor-prose p").last()).toHaveText("beta");
  await page.evaluate(() => window.linkCommandFixture.destroy("A"));
});

for (const entry of ["main", "api"] as const) {
  for (const gradient of [null, "linear-gradient(90deg, #2abcbf, #3836dd)"]) {
    test(`${entry} 新建${gradient ? "渐变" : "彩色"}链接恢复默认文字色并保留其他格式及两步历史`, async ({ page }) => {
      await page.evaluate(
        ({ entry, gradient }) => {
          window.linkCommandFixture.mount(
            "A",
            {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "甲",
                      marks: [
                        { type: "bold" },
                        { type: "italic" },
                        { type: "underline" },
                        { type: "strike" },
                        { type: "highlight", attrs: { color: "#fbde28" } },
                        {
                          type: "textStyle",
                          attrs: { color: "#df2a3f", fontSize: "24px", semloEditorGradient: gradient },
                        },
                      ],
                    },
                    { type: "text", text: "乙" },
                  ],
                },
                { type: "paragraph", content: [{ type: "text", text: "TAIL" }] },
              ],
            },
            entry === "api" ? "hidden" : "default",
          );
          window.linkCommandFixture.select("A", "甲", 0, 2);
        },
        { entry, gradient },
      );
      const before = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
      await openLink(page, entry);
      const pending = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
      const marks = pending.content![0].content![0].marks!;
      expect(marks.find((mark) => mark.type === "textStyle")?.attrs).toMatchObject({
        color: null,
        semloEditorGradient: null,
        fontSize: "24px",
      });
      expect(marks.filter((mark) => !["link", "textStyle"].includes(mark.type))).toEqual(
        before.content![0].content![0].marks!.filter((mark) => mark.type !== "textStyle"),
      );
      expect(pending.content![1]).toEqual(before.content![1]);
      await applyLink(page, entry, "https://example.com/", "甲乙");
      const after = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
      expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
      expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(pending);
      expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
      expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(before);
      expect(await page.evaluate(() => window.linkCommandFixture.redo("A"))).toBe(true);
      expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(pending);
      expect(await page.evaluate(() => window.linkCommandFixture.redo("A"))).toBe(true);
      expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(after);
      await page.evaluate(() => window.linkCommandFixture.destroy("A"));
    });
  }
}

for (const entry of ["main", "custom-floating", "shortcut", "custom", "api"] as const) {
  test(`${entry} 新建链接保留格式、选区与两步撤销重做`, async ({ page }) => {
    const mode: "custom" | "hidden" | "default" | "custom-floating" =
      entry === "custom"
        ? "custom"
        : entry === "custom-floating"
          ? "custom-floating"
          : entry === "api"
            ? "hidden"
            : "default";
    await page.evaluate(
      (mode) => window.linkCommandFixture.mount("A", "<p><strong><em>alpha</em></strong> beta</p>", mode),
      mode,
    );
    await page.evaluate(() => window.linkCommandFixture.select("A", "alpha", 0, 5, true));
    const before = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
    const beforeSelection = await page.evaluate(() => window.linkCommandFixture.selection("A"));
    expect(beforeSelection).toEqual({ text: "alpha", backward: true, empty: false });
    expect(await page.evaluate(() => window.linkCommandFixture.state("A"))).toEqual({ active: false, enabled: true });
    await openLink(page, entry);
    const editor = page.locator("#link-command-A .semlo-editor-prose");
    const placeholder = editor.locator("a[data-semlo-editor-link-placeholder]");
    await expect(placeholder.locator("strong em")).toHaveText("alpha");
    await expect(placeholder).not.toHaveAttribute("href");
    const pending = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
    expect(await page.evaluate(() => window.linkCommandFixture.state("A"))).toEqual({ active: true, enabled: true });
    expect((await page.evaluate(() => window.linkCommandFixture.selection("A"))).text).toBe("alpha");
    const result = await applyLink(page, entry, "example.com/path", "alpha");
    if (entry === "api") expect(result).toBe("applied");
    const link = editor.locator("a[href='https://example.com/path']");
    await expect(link.locator("strong em")).toHaveText("alpha");
    const after = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
    const afterSelection = await page.evaluate(() => window.linkCommandFixture.selection("A"));
    expect(afterSelection.text).toBe("alpha");
    expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
    expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(pending);
    expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
    expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(before);
    expect(await page.evaluate(() => window.linkCommandFixture.selection("A"))).toEqual(beforeSelection);
    expect(await page.evaluate(() => window.linkCommandFixture.redo("A"))).toBe(true);
    expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(pending);
    expect(await page.evaluate(() => window.linkCommandFixture.redo("A"))).toBe(true);
    expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(after);
    expect(await page.evaluate(() => window.linkCommandFixture.selection("A"))).toEqual(afterSelection);
    await page.evaluate(() => window.linkCommandFixture.destroy("A"));
  });
}

test("地址校验沿用链接支持的协议、相对地址与裸域名", async ({ page }) => {
  const cases = [
    [" https://example.com/path ", "https://example.com/path"],
    ["http://example.com", "http://example.com"],
    ["mailto:person@example.com", "mailto:person@example.com"],
    ["example.com/path", "https://example.com/path"],
    ["/inside", "/inside"],
    ["#section", "#section"],
    ["./relative", "./relative"],
    ["../relative", "../relative"],
    ["javascript:alert(1)", null],
    ["data:text/html,x", null],
    ["ftp://example.com", null],
    ["blob:https://example.com/id", null],
    ["//example.com", null],
    ["  ", null],
  ] as const;
  for (const [input, expected] of cases)
    expect(await page.evaluate((input) => window.linkCommandFixture.normalize(input), input)).toBe(expected);
});

test("链接规则分离后图片弹层仍校验并接受站内图片地址", async ({ page }) => {
  await page.evaluate(() => {
    window.linkCommandFixture.mount("A", "<p>alpha</p>", "default");
    window.linkCommandFixture.select("A", "alpha", 5, 5);
  });
  await page.locator("#link-command-A").getByRole("button", { name: "插入内容" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('[data-command="image"]').click();
  const form = page.getByRole("dialog", { name: "插入图片" });
  const address = form.getByLabel("图片地址");
  await address.fill("javascript:alert(1)");
  await form.getByRole("button", { name: "确定" }).click();
  await expect(form).toBeVisible();
  expect(await address.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  await address.fill("/image.svg");
  await form.getByRole("button", { name: "确定" }).click();
  await expect(page.locator('#link-command-A .semlo-editor-prose img[src="/image.svg"]')).toHaveCount(1);
  await page.evaluate(() => window.linkCommandFixture.destroy("A"));
});

test("空光标会话取消保留占位，输入错误不使会话失效", async ({ page }) => {
  await page.evaluate(() => {
    window.linkCommandFixture.mount("A", "<p><strong>alpha</strong></p>");
    window.linkCommandFixture.select("A", "alpha", 5, 5);
  });
  const before = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
  expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(true);
  expect(await page.evaluate(() => window.linkCommandFixture.session("A"))).toMatchObject({
    text: "链接",
    href: null,
    existing: false,
    valid: true,
  });
  const pending = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "javascript:alert(1)", "链接"))).toBe(
    "invalid-url",
  );
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "#section", " "))).toBe("invalid-text");
  expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(pending);
  expect((await page.evaluate(() => window.linkCommandFixture.session("A")))?.valid).toBe(true);
  await page.evaluate(() => {
    window.linkCommandFixture.close("A");
    window.linkCommandFixture.close("A");
  });
  expect(await page.evaluate(() => window.linkCommandFixture.invalidations("A"))).toBe(0);
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "#section", "链接"))).toBe("unavailable");
  expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(pending);
  expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
  expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(before);
  await page.evaluate(() => window.linkCommandFixture.destroy("A"));
});

test("编辑已有链接保留文字格式，移除操作使用原会话目标", async ({ page }) => {
  await page.evaluate(() => {
    window.linkCommandFixture.mount("A", '<p><a href="https://old.example"><strong>alpha</strong></a> beta</p>');
    window.linkCommandFixture.select("A", "alpha", 2, 2);
  });
  const before = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
  expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(true);
  expect(await page.evaluate(() => window.linkCommandFixture.session("A"))).toMatchObject({
    text: "alpha",
    href: "https://old.example",
    existing: true,
    valid: true,
  });
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "#changed", "renamed"))).toBe("applied");
  const editor = page.locator("#link-command-A .semlo-editor-prose");
  await expect(editor.locator('a[href="#changed"] strong')).toHaveText("renamed");
  const after = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
  expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
  expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(before);
  expect(await page.evaluate(() => window.linkCommandFixture.redo("A"))).toBe(true);
  expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(after);
  await page.evaluate(() => window.linkCommandFixture.select("A", "renamed", 2, 2));
  expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(true);
  await page.evaluate(() => window.linkCommandFixture.select("A", " beta", 1, 5));
  expect(await page.evaluate(() => window.linkCommandFixture.remove("A"))).toBe(true);
  await expect(editor.locator("a")).toHaveCount(0);
  await expect(editor.locator("strong")).toHaveText("renamed");
  expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
  expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(after);
  await page.evaluate(() => window.linkCommandFixture.destroy("A"));
});

for (const mode of ["default", "custom"] as const) {
  test(`${mode} 工具栏可编辑和移除已有链接并撤销`, async ({ page }) => {
    await page.evaluate((mode) => {
      window.linkCommandFixture.mount(
        "A",
        '<p><a href="https://old.example"><strong>alpha</strong></a> beta</p>',
        mode,
      );
      window.linkCommandFixture.select("A", "alpha", 2, 2);
    }, mode);
    const before = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
    const entry = mode === "default" ? "main" : "custom";
    await openLink(page, entry);
    const form =
      mode === "default"
        ? page.getByRole("dialog", { name: "插入链接" })
        : page.getByRole("form", { name: "链接设置" });
    await expect(form.getByRole("button", { name: "移除链接" })).toBeVisible();
    await applyLink(page, entry, "./new", "renamed");
    const editor = page.locator("#link-command-A .semlo-editor-prose");
    await expect(editor.locator('a[href="./new"] strong')).toHaveText("renamed");
    const after = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
    expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
    expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(before);
    expect(await page.evaluate(() => window.linkCommandFixture.redo("A"))).toBe(true);
    expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(after);
    await page.evaluate(() => window.linkCommandFixture.select("A", "renamed", 2, 2));
    await openLink(page, entry);
    await form.getByRole("button", { name: "移除链接" }).click();
    await expect(editor.locator("a")).toHaveCount(0);
    await expect(editor.locator("strong")).toHaveText("renamed");
    expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
    expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(after);
    await page.evaluate(() => window.linkCommandFixture.destroy("A"));
  });
}

test("失效会话不能修改新文档，选区变化仍指向原目标", async ({ page }) => {
  await page.evaluate(() => {
    window.linkCommandFixture.mount("A", "<p>alpha beta</p>");
    window.linkCommandFixture.select("A", "alpha beta", 0, 5, true);
  });
  expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(true);
  await page.evaluate(() => window.linkCommandFixture.select("A", " beta", 1, 5));
  expect((await page.evaluate(() => window.linkCommandFixture.session("A")))?.valid).toBe(true);
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "#alpha", "alpha"))).toBe("applied");
  await expect(page.locator("#link-command-A .semlo-editor-prose a")).toHaveText("alpha");
  await page.evaluate(() => window.linkCommandFixture.select("A", "alpha", 0, 5));
  expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(true);
  await page.evaluate(() => window.linkCommandFixture.setContent("A", "<p>new document</p>"));
  expect((await page.evaluate(() => window.linkCommandFixture.session("A")))?.valid).toBe(false);
  expect(await page.evaluate(() => window.linkCommandFixture.invalidations("A"))).toBe(2);
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "#stale", "old"))).toBe("unavailable");
  await expect(page.locator("#link-command-A .semlo-editor-prose")).toHaveText("new document");
  await page.evaluate(() => window.linkCommandFixture.destroy("A"));
});

test("只读、卸载和销毁会永久使旧会话失效", async ({ page }) => {
  await page.evaluate(() => {
    window.linkCommandFixture.mount("A", "<p>alpha</p>");
    window.linkCommandFixture.select("A", "alpha", 0, 5);
  });
  expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(true);
  await page.evaluate(() => {
    window.linkCommandFixture.editable("A", false);
    window.linkCommandFixture.editable("A", true);
  });
  expect((await page.evaluate(() => window.linkCommandFixture.session("A")))?.valid).toBe(false);
  expect(await page.evaluate(() => window.linkCommandFixture.invalidations("A"))).toBe(1);
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "#stale", "alpha"))).toBe("unavailable");
  expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(true);
  await page.evaluate(() => window.linkCommandFixture.unmount("A"));
  expect(await page.evaluate(() => window.linkCommandFixture.state("A"))).toEqual({ active: false, enabled: false });
  expect((await page.evaluate(() => window.linkCommandFixture.session("A")))?.valid).toBe(false);
  expect(await page.evaluate(() => window.linkCommandFixture.invalidations("A"))).toBe(2);
  await page.evaluate(() => window.linkCommandFixture.remount("A"));
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "#stale", "alpha"))).toBe("unavailable");
  expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(true);
  await page.evaluate(() => window.linkCommandFixture.destroy("A"));
  expect(await page.evaluate(() => window.linkCommandFixture.state("A"))).toEqual({ active: false, enabled: false });
  expect((await page.evaluate(() => window.linkCommandFixture.session("A")))?.valid).toBe(false);
  expect(await page.evaluate(() => window.linkCommandFixture.invalidations("A"))).toBe(3);
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "#stale", "alpha"))).toBe("unavailable");
});

for (const mode of ["default", "custom"] as const) {
  test(`${mode} 链接界面在卸载时关闭，重挂载后可继续编辑占位`, async ({ page }) => {
    await page.evaluate((mode) => {
      window.linkCommandFixture.mount("A", "<p>alpha</p>", mode);
      window.linkCommandFixture.select("A", "alpha", 0, 5);
    }, mode);
    await openLink(page, mode === "default" ? "main" : "custom");
    const form =
      mode === "default"
        ? page.getByRole("dialog", { name: "插入链接" })
        : page.getByRole("form", { name: "链接设置" });
    await expect(form).toBeVisible();
    await page.evaluate(() => window.linkCommandFixture.unmount("A"));
    await expect(form).toBeHidden();
    await page.evaluate(() => {
      window.linkCommandFixture.remount("A");
      window.linkCommandFixture.select("A", "alpha", 0, 5);
    });
    await openLink(page, mode === "default" ? "main" : "custom");
    await expect(form).toBeVisible();
    await applyLink(page, mode === "default" ? "main" : "custom", "#after", "alpha");
    await expect(page.locator('#link-command-A .semlo-editor-prose a[href="#after"]')).toHaveText("alpha");
    await page.evaluate(() => window.linkCommandFixture.destroy("A"));
  });
}

test("宿主拒绝事务时不报告成功或破坏链接占位及历史", async ({ page }) => {
  await page.evaluate(() => {
    window.linkCommandFixture.mount("A", "<p>alpha</p>");
    window.linkCommandFixture.select("A", "alpha", 0, 5);
  });
  const before = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
  await page.evaluate(() => window.linkCommandFixture.deny("A", true));
  expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(false);
  expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(before);
  await page.evaluate(() => window.linkCommandFixture.deny("A", false));
  expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(true);
  const pending = await page.evaluate(() => window.linkCommandFixture.snapshot("A"));
  await page.evaluate(() => window.linkCommandFixture.deny("A", true));
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "#ok", "alpha"))).toBe("rejected");
  expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(pending);
  await page.evaluate(() => window.linkCommandFixture.deny("A", false));
  expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
  expect(await page.evaluate(() => window.linkCommandFixture.snapshot("A"))).toEqual(before);
  await page.evaluate(() => window.linkCommandFixture.destroy("A"));
});

test("失效通知抛错时仍释放会话，旧会话不能再次写入", async ({ page }) => {
  await page.evaluate(() => {
    window.linkCommandFixture.mount("A", "<p>alpha</p>");
    window.linkCommandFixture.select("A", "alpha", 0, 5);
  });
  expect(await page.evaluate(() => window.linkCommandFixture.start("A", true))).toBe(true);
  const message = await page.evaluate(() => {
    try {
      window.linkCommandFixture.insert("A", "new");
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(message).toContain("链接会话失效通知失败");
  expect((await page.evaluate(() => window.linkCommandFixture.session("A")))?.valid).toBe(false);
  expect(await page.evaluate(() => window.linkCommandFixture.invalidations("A"))).toBe(1);
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "#stale", "alpha"))).toBe("unavailable");
  await page.evaluate(() => {
    window.linkCommandFixture.close("A");
    window.linkCommandFixture.destroy("A");
  });
  expect(await page.evaluate(() => window.linkCommandFixture.invalidations("A"))).toBe(1);
});

test("多个编辑器的链接会话和受控回写互不干扰", async ({ page }) => {
  await page.evaluate(() => {
    window.linkCommandFixture.mount("A", "<p>alpha</p>", "hidden", true);
    window.linkCommandFixture.mount("B", "<p>bravo</p>");
    window.linkCommandFixture.select("A", "alpha", 0, 5);
  });
  expect(await page.evaluate(() => window.linkCommandFixture.start("A"))).toBe(true);
  await page.waitForFunction(() => window.linkCommandFixture.echoes("A") > 0);
  expect((await page.evaluate(() => window.linkCommandFixture.session("A")))?.valid).toBe(true);
  await page.evaluate(() => window.linkCommandFixture.select("B", "bravo", 0, 5));
  expect(await page.evaluate(() => window.linkCommandFixture.start("B"))).toBe(true);
  expect(await page.evaluate(() => window.linkCommandFixture.apply("B", "#b", "bravo"))).toBe("applied");
  expect((await page.evaluate(() => window.linkCommandFixture.session("A")))?.valid).toBe(true);
  await page.evaluate(() => window.linkCommandFixture.destroy("B"));
  expect(await page.evaluate(() => window.linkCommandFixture.apply("A", "#a", "alpha"))).toBe("applied");
  await expect(page.locator('#link-command-A .semlo-editor-prose a[href="#a"]')).toHaveText("alpha");
  expect(await page.evaluate(() => window.linkCommandFixture.undo("A"))).toBe(true);
  await expect(page.locator("#link-command-A a[data-semlo-editor-link-placeholder]")).toHaveText("alpha");
  await page.evaluate(() => window.linkCommandFixture.destroy("A"));
});
