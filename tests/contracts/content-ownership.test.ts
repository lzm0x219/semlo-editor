import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import type { EntryKind, SourceKind } from "../fixtures/contracts/content-ownership-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/contracts/content-ownership-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installFixtureGuards(page);
  await page.goto(origin);
  try {
    await page.waitForFunction(() => typeof window.mountContentOwnershipFixture === "function", null, {
      timeout: 5000,
    });
  } catch {
    throw new Error(`内容所有权测试页面未就绪：${JSON.stringify(errors)}；${(await page.content()).slice(0, 1000)}`);
  }
});

for (const entryKind of ["initial", "setContent"] as const satisfies readonly EntryKind[]) {
  for (const sourceKind of ["plain", "reactive", "cross-realm-reactive"] as const satisfies readonly SourceKind[]) {
    test(`${entryKind}: ${sourceKind} input remains independent of both editors`, async ({ page }) => {
      await page.evaluate(
        ({ sourceKind, entryKind }) =>
          window.__semloRequireFixture("mountContentOwnershipFixture")(sourceKind, entryKind),
        { sourceKind, entryKind },
      );
      const before = await page.evaluate(() => {
        const { first, second } = window.__semloRequireFixture("contentOwnershipFixture");
        return [first.getSnapshot(), second.getSnapshot()];
      });

      await page.evaluate(() => {
        const { source } = window.__semloRequireFixture("contentOwnershipFixture");
        source.attrs.hostRoot.nested[0].value = "宿主根属性";
        source.content[0].attrs.data.shapes.push({
          id: "host-shape",
          shape: "rectangle",
          x: 10,
          y: 10,
          width: 100,
          height: 80,
          text: "宿主写入",
        });
        source.content[1].attrs.hostField.nested[0].value = "宿主字段";
        source.content[1].content[0].marks[0].attrs.hostMark.value = "宿主标记";
      });
      const afterHostMutation = await page.evaluate(() => {
        const { first, second, changes, errors } = window.__semloRequireFixture("contentOwnershipFixture");
        return { snapshots: [first.getSnapshot(), second.getSnapshot()], changes, errors };
      });
      expect(afterHostMutation.snapshots).toEqual(before);
      expect(afterHostMutation.changes).toEqual([0, 0]);
      expect(afterHostMutation.errors).toEqual([]);

      await page.evaluate(() => {
        const { first, source } = window.__semloRequireFixture("contentOwnershipFixture");
        first.setContent(source);
      });
      const committed = await page.evaluate(() => {
        const { first, second, changes } = window.__semloRequireFixture("contentOwnershipFixture");
        return { first: first.getSnapshot(), second: second.getSnapshot(), changes: [...changes] };
      });
      expect(committed.first.json.content?.[0].attrs?.data.shapes[0].text).toBe("宿主写入");
      expect(committed.first.json.attrs?.hostRoot.nested[0].value).toBe("宿主根属性");
      expect(committed.first.json.content?.[1].attrs?.hostField.nested[0].value).toBe("宿主字段");
      expect(committed.first.json.content?.[1].content?.[0].marks?.[0].attrs?.hostMark.value).toBe("宿主标记");
      expect(committed.second).toEqual(before[1]);
      expect(committed.changes).toEqual([0, 0]);

      await page.evaluate(() => {
        const { source } = window.__semloRequireFixture("contentOwnershipFixture");
        source.attrs.hostRoot.nested[0].value = "再次修改";
        source.content[0].attrs.data.shapes[0].text = "再次修改";
        source.content[1].attrs.hostField.nested[0].value = "再次修改";
        source.content[1].content[0].marks[0].attrs.hostMark.value = "再次修改";
      });
      const afterFurtherMutation = await page.evaluate(() => {
        const { first, second, changes } = window.__semloRequireFixture("contentOwnershipFixture");
        return { first: first.getSnapshot(), second: second.getSnapshot(), changes: [...changes] };
      });
      expect(afterFurtherMutation).toEqual(committed);

      const edit = await page.evaluate(() => {
        const { first, second, source, changes } = window.__semloRequireFixture("contentOwnershipFixture");
        first.editor.commands.insertContentAt(2, "编辑");
        const written = first.getSnapshot();
        first.editor.commands.undo();
        const undone = first.getSnapshot();
        first.editor.commands.redo();
        return {
          written,
          undone,
          redone: first.getSnapshot(),
          other: second.getSnapshot(),
          sourceText: source.content[1].content[0].text,
          changes: [...changes],
        };
      });
      expect(edit.written.text).toContain("编辑原文");
      expect(edit.undone.text).not.toContain("编辑原文");
      expect(edit.redone.json).toEqual(edit.written.json);
      expect(edit.other).toEqual(before[1]);
      expect(edit.sourceText).toBe("原文");
      expect(edit.changes).toEqual([3, 0]);
    });
  }
}

for (const scenario of ["root", "root-and-body", "body"] as const) {
  test(`setContent 替换 ${scenario} 时保持文档根属性契约`, async ({ page }) => {
    const result = await page.evaluate((scenario) => {
      window.__semloRequireFixture("mountContentOwnershipFixture")("plain", "initial");
      const { source, first, second, changes } = window.__semloRequireFixture("contentOwnershipFixture");
      let transactions = 0;
      first.editor.on("transaction", ({ transaction }) => {
        if (transaction.docChanged) transactions++;
      });
      const before = first.getSnapshot();
      first.setContent(JSON.parse(JSON.stringify(source)));
      const same = { snapshot: first.getSnapshot(), transactions, changes: [...changes] };

      const next = JSON.parse(JSON.stringify(source));
      if (scenario !== "body") next.attrs.hostRoot.nested[0].value = "新根属性";
      if (scenario !== "root") next.content[1].content[0].text = "新正文";
      first.setContent(next);
      const replaced = { snapshot: first.getSnapshot(), transactions, changes: [...changes] };

      next.attrs.hostRoot.nested[0].value = "替换后继续修改";
      next.content[1].content[0].text = "替换后继续修改";
      const afterHostMutation = { snapshot: first.getSnapshot(), transactions, changes: [...changes] };
      first.editor.commands.undo();
      const undone = { snapshot: first.getSnapshot(), transactions, changes: [...changes] };
      first.editor.commands.redo();
      const redone = { snapshot: first.getSnapshot(), transactions, changes: [...changes] };
      return { before, same, replaced, afterHostMutation, undone, redone, second: second.getSnapshot() };
    }, scenario);
    expect(result.same).toEqual({ snapshot: result.before, transactions: 0, changes: [0, 0] });
    expect(result.replaced.snapshot.json.attrs?.hostRoot.nested[0].value).toBe(
      scenario === "body" ? "初始根属性" : "新根属性",
    );
    expect(result.replaced.snapshot.text).toContain(scenario === "root" ? "原文" : "新正文");
    expect(result.replaced.transactions).toBe(1);
    expect(result.replaced.changes).toEqual([0, 0]);
    expect(result.afterHostMutation).toEqual(result.replaced);
    expect(result.undone.snapshot.json).toEqual(result.before.json);
    expect(result.undone.changes).toEqual([1, 0]);
    expect(result.redone.snapshot.json).toEqual(result.replaced.snapshot.json);
    expect(result.redone.changes).toEqual([2, 0]);
    expect(result.second).toEqual(result.before);
  });
}

test("文档字体属性仍可通过 JSON 和 HTML 替换及恢复", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.__semloRequireFixture("mountContentOwnershipFixture")("plain", "initial");
    const { first, errors } = window.__semloRequireFixture("contentOwnershipFixture");
    const json = first.getSnapshot().json;
    json.content = [{ type: "paragraph", content: [{ type: "text", text: "字体正文" }] }];
    json.attrs!.semloEditorDocumentFontFamily = "Example Family";
    json.attrs!.semloEditorDocumentFontName = "Example Family Regular";
    json.attrs!.semloEditorDocumentFontVariants = { bold: "Example Family Bold" };
    first.setContent(json);
    const saved = first.getSnapshot();
    first.setContent("<p>临时内容</p>");
    first.setContent(saved.html);
    return { saved: saved.json.attrs, restored: first.getSnapshot().json.attrs, errors };
  });
  const font = {
    semloEditorDocumentFontFamily: "Example Family",
    semloEditorDocumentFontName: "Example Family Regular",
    semloEditorDocumentFontVariants: { bold: "Example Family Bold" },
  };
  expect(result).toMatchObject({ saved: font, restored: font, errors: [] });
});

test("可恢复中性 span 的文字，样式和不支持的嵌套元素仍遵守校验", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.__semloRequireFixture("mountContentOwnershipFixture")("plain", "initial");
    const { source, first, errors } = window.__semloRequireFixture("contentOwnershipFixture");
    first.setContent({ type: "doc", content: [source.content[1]] });
    const saved = first.getSnapshot();
    first.setContent("<p>临时内容</p>");
    first.setContent(saved.html);
    const restored = first.getSnapshot();
    const restorationErrors = [...errors];
    errors.length = 0;

    first.setContent('<p><span style="color: #ff0000">红字</span></p>');
    const styled = first.getSnapshot();
    const styledErrors = [...errors];
    errors.length = 0;
    first.setContent("<p><span><unsupported-element>未知内容</unsupported-element></span></p>");
    const nestedErrors = [...errors];
    const afterNested = first.getSnapshot();
    errors.length = 0;
    first.setContent('<p><span data-unsupported="x">未知属性</span></p>');
    return {
      saved: saved.html,
      restored,
      restorationErrors,
      styled,
      styledErrors,
      nestedErrors,
      afterNested,
      attributeErrors: [...errors],
      afterAttribute: first.getSnapshot(),
    };
  });
  expect(result.saved).toBe("<p><span>原文</span></p>");
  expect(result.restored.text).toBe("原文");
  expect(result.restorationErrors).toEqual([]);
  expect(result.styled.text).toBe("红字");
  expect(result.styled.html).toContain("color");
  expect(result.styledErrors).toEqual([]);
  expect(result.nestedErrors).toHaveLength(1);
  expect(result.nestedErrors[0]).toContain("Invalid HTML content");
  expect(result.afterNested).toEqual(result.styled);
  expect(result.attributeErrors).toHaveLength(1);
  expect(result.attributeErrors[0]).toContain("Invalid HTML content");
  expect(result.afterAttribute).toEqual(result.styled);
});

test("宿主自定义 JSON 的特殊属性名仍作为数据保留", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.__semloRequireFixture("mountContentOwnershipFixture")("plain", "initial");
    const { source, first } = window.__semloRequireFixture("contentOwnershipFixture");
    const field = source.content[1].attrs.hostField;
    Object.defineProperty(field, "__proto__", { value: { name: "保留" }, enumerable: true, writable: true });
    first.setContent(source);
    const saved = first.getSnapshot().json.content![1].attrs!.hostField;
    return {
      own: Object.hasOwn(saved, "__proto__"),
      value: Object.getOwnPropertyDescriptor(saved, "__proto__")?.value.name,
      prototypeUnchanged: Object.getPrototypeOf(saved) === Object.prototype,
    };
  });
  expect(result).toEqual({ own: true, value: "保留", prototypeUnchanged: true });
});
