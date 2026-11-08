import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../fixtures/browser/fixture-rsbuild";
import type {} from "../fixtures/contracts/content-safety-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/contracts/content-safety-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => !!window.contentSafetyFixture);
});

const invalidInitialContent = [
  {
    name: "未知 JSON 节点",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "需要保留的原文" }] }, { type: "foreignNode" }],
    },
    message: "Invalid JSON content",
  },
  {
    name: "未声明的 JSON 属性",
    content: { type: "doc", content: [{ type: "paragraph", attrs: { externalFormat: "重要元数据" } }] },
    message: "externalFormat",
  },
  {
    name: "未声明的文本标记属性",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "正文", marks: [{ type: "textStyle", attrs: { externalStyle: "自定义" } }] }],
        },
      ],
    },
    message: "externalStyle",
  },
];

for (const sample of invalidInitialContent) {
  test(`初始化拒绝${sample.name}并清理实例`, async ({ page }) => {
    const result = await page.evaluate(
      (content) => window.__semloRequireFixture("contentSafetyFixture").initialize(content),
      sample.content,
    );
    expect(result.error).toContain(sample.message);
    expect(result.snapshot).toBeNull();
    expect(result.changes).toBe(0);
    expect(result.onErrors).toEqual([]);
    expect(result.inputUnchanged).toBe(true);
    expect(result.destroyEvents).toBe(1);
    expect(result.pluginCreated).toBeGreaterThan(0);
    expect(result.pluginDestroyed).toBe(result.pluginCreated);
    expect(result.editorDestroyed).toBe(true);
    expect(result.shellPresent).toBe(false);
    expect(result.sentinelPresent).toBe(true);
    expect(result.otherText).toBe("独立实例仍可编辑");
  });
}

test("普通 HTML 和宿主自定义 data 属性仍可导入", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("contentSafetyFixture");
    return {
      initialized: fixture.initialize(
        '<article data-host-source="external"><h2>标题</h2><p>文字<strong>正文</strong></p></article>',
      ),
      replaced: fixture.replace('<p data-host-source="external">新内容<strong>正文</strong></p>'),
    };
  });
  expect(result.initialized.error).toBeNull();
  expect(result.initialized.snapshot?.text).toBe("标题\n\n文字正文");
  expect(result.initialized.changes).toBe(0);
  expect(result.initialized.otherText).toBe("独立实例仍可编辑");
  expect(result.replaced.errors).toEqual([]);
  expect(result.replaced.after.text).toBe("新内容正文");
});

test("schema 中声明的宿主属性可用于初始化和替换，空 attrs 也可正常加载", async ({ page }) => {
  const content = {
    type: "doc",
    attrs: {},
    content: [
      {
        type: "paragraph",
        attrs: { hostField: { customValue: 2, content: [{ type: "foreignNode" }] } },
        content: [{ type: "text", text: "自定义", marks: [{ type: "textStyle", attrs: { hostMark: "扩展标记" } }] }],
      },
    ],
  };
  const initialized = await page.evaluate(
    (value) => window.__semloRequireFixture("contentSafetyFixture").initialize(value, true),
    content,
  );
  const replaced = await page.evaluate(
    (value) => window.__semloRequireFixture("contentSafetyFixture").replace(value, true),
    content,
  );
  expect(initialized.error).toBeNull();
  expect(initialized.snapshot?.json.content?.[0]?.attrs?.hostField).toEqual(content.content[0].attrs.hostField);
  expect(initialized.snapshot?.json.content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.hostMark).toBe("扩展标记");
  expect(replaced.errors).toEqual([]);
  expect(replaced.after.json.content?.[0]?.attrs?.hostField).toEqual(content.content[0].attrs.hostField);
  expect(replaced.after.json.content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.hostMark).toBe("扩展标记");
});

for (const sample of invalidInitialContent) {
  test(`替换时拒绝${sample.name}且保留原文档`, async ({ page }) => {
    const result = await page.evaluate(
      (content) => window.__semloRequireFixture("contentSafetyFixture").replace(content),
      sample.content,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(sample.message);
    expect(result.after).toEqual(result.before);
  });
}

test("替换时拒绝未知 HTML 元素并保留原文档", async ({ page }) => {
  const result = await page.evaluate(() =>
    window
      .__semloRequireFixture("contentSafetyFixture")
      .replace("<p>正文<unknown-element>无法识别</unknown-element></p>"),
  );
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("Invalid HTML content");
  expect(result.after).toEqual(result.before);
});

test("当前格式 JSON 和 HTML 均可读取并重新输出", async ({ page }) => {
  const result = await page.evaluate(() => window.__semloRequireFixture("contentSafetyFixture").roundtrip());
  expect(result.jsonEqual).toBe(true);
  expect(result.htmlText).toBe("标题\n\n正文和颜色");
});
