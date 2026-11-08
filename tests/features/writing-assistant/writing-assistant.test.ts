import { mkdtemp, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { beforeAll, afterAll, expect, test, type Page } from "@rstest/playwright";

import { readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/writing-assistant/writing-assistant-fixture";

let directory: string, bundle: string, styles: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-writing-assistant-"));
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { writing: resolve("tests/fixtures/writing-assistant/writing-assistant-fixture.ts") },
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        },
      },
      resolve: {
        alias: Object.fromEntries(
          ["core", "react", "vue", "solid"].map((name) => [
            `@semlo-editor/${name}$`,
            resolve(`packages/${name}/dist/index.js`),
          ]),
        ),
      },
      output: { distPath: { root: directory }, filename: { js: "[name].js" }, cleanDistPath: false },
      tools: { rspack: { optimization: { splitChunks: false, runtimeChunk: false } } },
    },
  });
  await build.build();
  bundle = await readInlineFixtureBundle(directory);
  styles = await readFile(resolve("packages/core/dist/style.css"), "utf8");
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(
  page: Page,
  mode: "core" | "react" | "vue" | "solid" = "core",
  enabled = true,
  controlled = false,
  custom = false,
  feedbackEnabled = false,
) {
  await page.setContent(
    '<style>body{margin:0}#editor,#second{max-width:900px;margin:40px auto;width:calc(100% - 32px)}</style><div id="editor"></div>',
  );
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(
    ({ mode, enabled, controlled, custom, feedbackEnabled }) =>
      window.writingMount(mode, enabled, controlled, custom, feedbackEnabled),
    { mode, enabled, controlled, custom, feedbackEnabled },
  );
  await page.waitForFunction(() => Boolean(window.writingEditor));
}

for (const mode of ["core", "react", "vue", "solid"] as const) {
  test(`${mode}: 写作反馈关联草稿并支持动态更换宿主`, async ({ page }) => {
    await mount(page, mode, true, false, false, true);
    await open(page);
    await send(page, "帮我写作");
    await page.evaluate(() =>
      window.writingPending[0].resolve({ format: "text", text: "生成草稿", feedbackId: "response-1" }),
    );
    await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("生成草稿");
    await page.getByRole("button", { name: "有帮助", exact: true }).click();
    await page.waitForFunction(() => window.writingFeedbackPending.length === 1);
    expect(
      await page.evaluate(() => {
        const { request, version } = window.writingFeedbackPending[0];
        return { rating: request.rating, prompt: request.prompt, result: request.result, version };
      }),
    ).toEqual({
      rating: "positive",
      prompt: "帮我写作",
      result: { format: "text", text: "生成草稿", feedbackId: "response-1" },
      version: "a",
    });
    await expect(page.getByRole("button", { name: "没有帮助", exact: true })).toBeDisabled();
    await page.evaluate(() => window.writingFeedbackPending[0].resolve());
    await expect(page.getByRole("button", { name: "有帮助", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => window.writingUpdateFeedback("b"));
    await expect(page.getByRole("button", { name: "有帮助", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("生成草稿");
    await page.getByRole("button", { name: "没有帮助", exact: true }).click();
    await page.waitForFunction(() => window.writingFeedbackPending.length === 2);
    expect(await page.evaluate(() => window.writingFeedbackPending[1].version)).toBe("b");
    await page.evaluate(() => window.writingFeedbackPending[1].resolve());
    await expect(page.getByRole("button", { name: "没有帮助", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await text(page)).toBe("原文");
    await page.getByRole("button", { name: "完成", exact: true }).click();
    expect(await text(page)).toContain("生成草稿");
    expect(await page.evaluate(() => JSON.stringify(window.writingEditor.getSnapshot().json))).not.toContain(
      "response-1",
    );
    expect(await page.evaluate(() => document.querySelector("#editor")!.hasAttribute("writingFeedback"))).toBe(false);
  });
}

test("未配置反馈服务时禁用按钮，失败后可重试", async ({ page }) => {
  await mount(page);
  await open(page);
  await send(page);
  await finish(page);
  await expect(page.getByRole("button", { name: "有帮助", exact: true })).toBeDisabled();
  await page.evaluate(() => window.writingUpdateFeedback("a"));
  await page.getByRole("button", { name: "有帮助", exact: true }).click();
  await page.waitForFunction(() => window.writingFeedbackPending.length === 1);
  await page.evaluate(() => window.writingFeedbackPending[0].reject(new Error("反馈网络失败")));
  await expect(page.getByText("反馈提交失败，请重试。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.writingErrors)).toContain("反馈网络失败");
  await page.getByRole("button", { name: "有帮助", exact: true }).click();
  await page.waitForFunction(() => window.writingFeedbackPending.length === 2);
  await page.evaluate(() => window.writingFeedbackPending[1].resolve());
  await expect(page.getByRole("button", { name: "有帮助", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await text(page)).toBe("原文");
});

test("重新生成或更换反馈服务时中止旧反馈并忽略迟到结果", async ({ page }) => {
  await mount(page, "core", true, false, false, true);
  await open(page);
  await send(page);
  await finish(page);
  await page.getByRole("button", { name: "有帮助", exact: true }).click();
  await page.waitForFunction(() => window.writingFeedbackPending.length === 1);
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  expect(await page.evaluate(() => window.writingFeedbackPending[0].request.signal.aborted)).toBe(true);
  await page.evaluate(() => window.writingFeedbackPending[0].reject(new Error("旧反馈失败")));
  await finish(page, "新草稿", 1);
  await expect(page.getByRole("button", { name: "有帮助", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "没有帮助", exact: true }).click();
  await page.waitForFunction(() => window.writingFeedbackPending.length === 2);
  await page.evaluate(() => window.writingUpdateFeedback("b"));
  expect(await page.evaluate(() => window.writingFeedbackPending[1].request.signal.aborted)).toBe(true);
  await page.evaluate(() => window.writingFeedbackPending[1].resolve());
  await page.getByRole("button", { name: "有帮助", exact: true }).click();
  await page.waitForFunction(() => window.writingFeedbackPending.length === 3);
  expect(await page.evaluate(() => window.writingFeedbackPending[2].version)).toBe("b");
  await page.evaluate(() => window.writingDestroy());
  expect(await page.evaluate(() => window.writingFeedbackPending[2].request.signal.aborted)).toBe(true);
  expect(await page.evaluate(() => window.writingErrors)).toEqual([]);
});
test("不同编辑器的反馈请求互不干扰", async ({ page }) => {
  await mount(page, "core", true, false, false, true);
  await open(page);
  await send(page);
  await finish(page);
  await page.getByRole("button", { name: "有帮助", exact: true }).click();
  await page.waitForFunction(() => window.writingFeedbackPending.length === 1);
  await page.evaluate(() => {
    window.writingSecond();
    const assistant = window.writingAssistant(window.writingEditors[1].editor)!;
    assistant.open();
    void assistant.send("第二个实例");
  });
  await page.waitForFunction(() => window.writingPending.length === 2);
  await page.evaluate(() => window.writingPending[1].resolve({ format: "text", text: "第二份草稿" }));
  await expect(page.locator("#second").getByLabel("写作草稿", { exact: true })).toHaveText("第二份草稿");
  await page.locator("#second").getByRole("button", { name: "没有帮助", exact: true }).click();
  await page.waitForFunction(() => window.writingFeedbackPending.length === 2);
  await page.locator("#editor").getByRole("button", { name: "关闭写作助手" }).click();
  expect(await page.evaluate(() => window.writingFeedbackPending.map(({ request }) => request.signal.aborted))).toEqual(
    [true, false],
  );
  await page.evaluate(() => window.writingFeedbackPending[1].resolve());
  await expect(page.locator("#second").getByRole("button", { name: "没有帮助" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await page.evaluate(() => window.writingEditors[1].getSnapshot().text)).toBe("实例二");
});
async function open(page: Page) {
  await page.getByRole("button", { name: "插入内容", exact: true }).first().click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="ai"]').click();
  await expect(page.getByRole("region", { name: "智能写作助手" })).toBeVisible();
}
async function send(page: Page, prompt = "改写为更清晰的正文") {
  await page.getByLabel("向智能助手提问", { exact: true }).fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => window.writingPending.length > 0);
}
async function finish(page: Page, text = "生成草稿", index = 0) {
  await page.evaluate(({ text, index }) => window.writingPending[index].resolve({ format: "text", text }), {
    text,
    index,
  });
  await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText(text);
}
async function text(page: Page) {
  return page.evaluate(() => window.writingEditor.getSnapshot().text);
}
async function accept(page: Page) {
  return page.evaluate(() => window.writingAssistant(window.writingEditor.editor)!.accept());
}

for (const mode of ["core", "react", "vue", "solid"] as const) {
  test(`${mode}: selected context stays intact until accept, controlled echo and one undo`, async ({ page }) => {
    await mount(page, mode, true, true);
    await page.evaluate(() => window.writingEditor.editor.commands.setTextSelection({ from: 1, to: 3 }));
    await open(page);
    expect(await text(page)).toBe("原文");
    await send(page);
    expect(await text(page)).toBe("原文");
    expect(await page.evaluate(() => window.writingPending[0].request.context.selection.text)).toBe("原文");
    await finish(page);
    expect(await text(page)).toBe("原文");
    await page.getByRole("button", { name: "替换选中内容", exact: true }).click();
    await expect(page.getByRole("region", { name: "智能写作助手" })).toHaveCount(0);
    expect(await text(page)).toBe("生成草稿");
    await page.evaluate(() => window.writingEditor.editor.commands.undo());
    expect(await text(page)).toBe("原文");
    await page.evaluate(() => window.writingEditor.editor.commands.redo());
    expect(await text(page)).toBe("生成草稿");
    expect(await page.evaluate(() => document.querySelector("#editor")!.hasAttribute("writingService"))).toBe(false);
  });
  test(`${mode}: dynamic service replacement and removal invalidate old responses`, async ({ page }) => {
    await mount(page, mode);
    await open(page);
    await send(page);
    await page.evaluate(() => window.writingUpdate("b"));
    await page.waitForFunction(() => window.writingPending[0].request.signal.aborted);
    await page.evaluate(() => window.writingPending[0].resolve({ format: "text", text: "旧服务" }));
    expect(await text(page)).toBe("原文");
    await expect(page.getByRole("region", { name: "智能写作助手" })).toHaveAttribute("data-status", "stale");
    await page.getByRole("button", { name: "关闭写作助手" }).click();
    await open(page);
    await send(page, "新服务请求");
    await page.waitForFunction(() => window.writingPending.length === 2);
    expect(await page.evaluate(() => window.writingPending[1].version)).toBe("b");
    await page.evaluate(() => window.writingUpdate(null));
    await page.waitForFunction(() => window.writingPending[1].request.signal.aborted);
    await page.getByRole("button", { name: "关闭写作助手" }).click();
    await page.getByRole("button", { name: "插入内容", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="ai"]'),
    ).toBeDisabled();
  });
  test(`${mode}: readonly and different controlled document retain a stale draft`, async ({ page }) => {
    await mount(page, mode);
    await open(page);
    await send(page);
    await finish(page);
    await page.evaluate(() => window.writingReadonly(true));
    await page.waitForFunction(
      () => window.writingAssistant(window.writingEditor.editor)!.getSnapshot().status === "stale",
    );
    expect(await accept(page)).toBe("unavailable");
    expect(await text(page)).toBe("原文");
    await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("生成草稿");
    await page.evaluate(() => window.writingReadonly(false));
    await page.getByRole("button", { name: "关闭写作助手" }).click();
    await open(page);
    await send(page);
    await finish(page, "二次草稿", 1);
    await page.evaluate(() => window.writingSetContent("<p>新文档</p>"));
    await page.waitForFunction(() => window.writingEditor.getSnapshot().text === "新文档");
    expect(await accept(page)).toBe("unavailable");
    await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("二次草稿");
  });
  test(`${mode}: framework unmount and new instance reject late provider callbacks`, async ({ page }) => {
    await mount(page, mode);
    await open(page);
    await send(page);
    await page.evaluate(() => window.writingDestroy());
    expect(await page.evaluate(() => window.writingPending[0].request.signal.aborted)).toBe(true);
    await page.evaluate(() => window.writingPending[0].resolve({ format: "text", text: "卸载后结果" }));
    await page.evaluate(() => window.writingMount("core"));
    await page.waitForFunction(() => !window.writingEditor.editor.isDestroyed);
    expect(await text(page)).toBe("原文");
  });
}

test("without a service, main and selection entries are disabled", async ({ page }) => {
  await mount(page, "core", false);
  await page.getByRole("button", { name: "插入内容", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="ai"]'),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.writingEditor.editor.chain().focus().setTextSelection({ from: 1, to: 3 }).run());
  await expect(page.getByRole("button", { name: "AI 写作", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.writingAssistant(window.writingEditor.editor)!.open())).toBe(false);
});
test("selection bubble opens the same assistant and cancel preserves selection", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.writingEditor.editor.chain().focus().setTextSelection({ from: 1, to: 3 }).run());
  await page.getByRole("button", { name: "AI 写作", exact: true }).click();
  await expect(page.getByLabel("向智能助手提问", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  expect(await text(page)).toBe("原文");
  expect(
    await page.evaluate(() => ({
      from: window.writingEditor.editor.state.selection.from,
      to: window.writingEditor.editor.state.selection.to,
    })),
  ).toEqual({ from: 1, to: 3 });
});
test("literal HTML-like output never becomes markup, and typing after accept has its own undo", async ({ page }) => {
  await mount(page);
  await open(page);
  await send(page);
  await finish(page, '<img src=x onerror="alert(1)">');
  await expect(page.getByLabel("写作草稿", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  expect(await page.locator(".semlo-editor-prose img").count()).toBe(0);
  expect(await text(page)).toContain('<img src=x onerror="alert(1)">');
  await page.keyboard.type("后续");
  await page.evaluate(() => window.writingEditor.editor.commands.undo());
  expect(await text(page)).not.toContain("后续");
  expect(await text(page)).toContain("<img");
  await page.evaluate(() => window.writingEditor.editor.commands.undo());
  expect(await text(page)).toBe("原文");
});
test("explicit schema JSON accepts tables and code blocks and round trips", async ({ page }) => {
  await mount(page);
  await open(page);
  await send(page);
  await page.evaluate(() =>
    window.writingPending[0].resolve({
      format: "json",
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "生成表格" }] }],
                  },
                ],
              },
            ],
          },
          { type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const x = 1;" }] },
        ],
      },
    }),
  );
  await expect(page.getByRole("region", { name: "智能写作助手" })).toHaveAttribute("data-status", "ready");
  const accepted = await accept(page);
  expect({
    accepted,
    message: await page.evaluate(() => window.writingAssistant(window.writingEditor.editor)!.getSnapshot().message),
  }).toEqual({ accepted: "applied", message: "" });
  await expect(page.locator(".semlo-editor-prose table")).toHaveCount(1);
  expect(await text(page)).toContain("const x = 1;");
  const html = await page.evaluate(() => window.writingEditor.getSnapshot().html);
  await page.evaluate((value) => window.writingEditor.setContent(value), html);
  expect(await text(page)).toContain("生成表格");
  await expect(page.locator(".semlo-editor-prose table")).toHaveCount(1);
});
test("invalid structures and service failures retain prompt and support retry", async ({ page }) => {
  await mount(page);
  await open(page);
  await send(page, "保留此提问");
  await page.evaluate(() =>
    window.writingPending[0].resolve({
      format: "json",
      content: { type: "doc", content: [{ type: "paragraph", attrs: { unknownAttribute: true } }] },
    }),
  );
  await expect(page.getByRole("region", { name: "智能写作助手" })).toHaveAttribute("data-status", "error");
  expect(await text(page)).toBe("原文");
  await expect(page.getByLabel("向智能助手提问", { exact: true })).toHaveValue("保留此提问");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(() => window.writingPending.length === 2);
  await page.evaluate(() => window.writingPending[1].reject(new Error("额度不足")));
  await expect(page.getByRole("region", { name: "智能写作助手" }).getByRole("status")).toHaveText("额度不足");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(() => window.writingPending.length === 3);
  await finish(page, "重试成功", 2);
  expect(await accept(page)).toBe("applied");
  expect(await text(page)).toContain("重试成功");
});
test("Escape stops, late ignored-signal output and out of order requests never overwrite newer work", async ({
  page,
}) => {
  await mount(page);
  await open(page);
  await send(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "智能写作助手" })).toHaveAttribute("data-status", "stopped");
  expect(await page.evaluate(() => window.writingPending[0].request.signal.aborted)).toBe(true);
  await page.evaluate(() => {
    const assistant = window.writingAssistant(window.writingEditor.editor)!;
    void assistant.send("第二次");
    void assistant.send("第三次");
  });
  await page.waitForFunction(() => window.writingPending.length === 3);
  await finish(page, "最新", 2);
  await page.evaluate(() => {
    window.writingPending[0].resolve({ format: "text", text: "已停止" });
    window.writingPending[1].resolve({ format: "text", text: "较旧" });
  });
  await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("最新");
  expect(await accept(page)).toBe("applied");
  expect(await text(page)).toContain("最新");
});
test("slash cancel retains the query; accepting replaces the query in one undo event", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.writingEditor.setContent("<p></p>"));
  await page.locator(".semlo-editor-prose").click();
  await page.keyboard.type("/ai");
  await page.locator('.semlo-editor-slash-menu [data-command="ai"]').click();
  expect(await text(page)).toBe("/ai");
  await page.getByRole("button", { name: "关闭写作助手" }).click();
  expect(await text(page)).toBe("/ai");
  await page.evaluate(() => window.writingAssistant(window.writingEditor.editor)!.open({ range: { from: 1, to: 4 } }));
  await send(page);
  await finish(page, "斜杠结果");
  expect(await accept(page)).toBe("applied");
  expect(await text(page)).toBe("斜杠结果");
  await page.evaluate(() => window.writingEditor.editor.commands.undo());
  expect(await text(page)).toBe("/ai");
});
test("block-below waits for accept, then inserts between unchanged neighboring blocks", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.writingEditor.setContent("<p>原块</p><p>后块</p>"));
  await page.locator(".semlo-editor-prose p").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="ai"]').click();
  expect(await text(page)).toBe("原块\n\n后块");
  await send(page);
  await finish(page, "中间草稿");
  expect(await accept(page)).toBe("applied");
  expect(await text(page)).toBe("原块\n\n中间草稿\n\n后块");
  await page.evaluate(() => window.writingEditor.editor.commands.undo());
  expect(await text(page)).toBe("原块\n\n后块");
});
test("host refusal keeps a retryable draft; host rewriting keeps an invalidated draft", async ({ page }) => {
  await mount(page);
  await open(page);
  await send(page);
  await finish(page);
  await page.evaluate(() => window.writingHost("reject"));
  expect(await accept(page)).toBe("rejected");
  expect(await text(page)).toBe("原文");
  await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("生成草稿");
  await page.evaluate(() => window.writingHost("none"));
  expect(await accept(page)).toBe("applied");
  await open(page);
  await send(page);
  await finish(page, "待改写草稿", 1);
  await page.evaluate(() => window.writingHost("rewrite"));
  expect(await accept(page)).toBe("unavailable");
  expect(await text(page)).toBe("宿主改写");
  await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("待改写草稿");
});
for (const action of ["provider", "readonly", "reenter"] as const) {
  test(`beforeTransaction ${action} reentry cannot commit stale output`, async ({ page }) => {
    await mount(page);
    await open(page);
    await send(page);
    await finish(page);
    await page.evaluate((action) => window.writingHost(action), action);
    expect(await accept(page)).not.toBe("applied");
    expect(await text(page)).toBe("原文");
    await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("生成草稿");
  });
}
test("doc changes and low-level unmount/remount invalidate old targets", async ({ page }) => {
  await mount(page);
  await open(page);
  await send(page);
  await page.evaluate(() => window.writingEditor.editor.commands.insertContent("改动"));
  expect(await page.evaluate(() => window.writingPending[0].request.signal.aborted)).toBe(true);
  await page.getByRole("button", { name: "关闭写作助手" }).click();
  await open(page);
  await send(page);
  await page.evaluate(() => {
    const editor = window.writingEditor.editor;
    editor.unmount();
    const host = document.createElement("div");
    document.querySelector("#editor")!.append(host);
    editor.mount(host);
  });
  expect(await page.evaluate(() => window.writingPending[1].request.signal.aborted)).toBe(true);
  await page.evaluate(() => window.writingPending[1].resolve({ format: "text", text: "旧视图" }));
  expect(await accept(page)).toBe("unavailable");
  expect(await text(page)).not.toContain("旧视图");
  await page.evaluate(() => window.writingAssistant(window.writingEditor.editor)!.cancel());
  expect(await page.evaluate(() => window.writingAssistant(window.writingEditor.editor)!.open())).toBe(true);
  await send(page, "重新挂载后继续写作");
  await page.waitForFunction(() => window.writingPending.length === 3);
  await finish(page, "新视图结果", 2);
  expect(await accept(page)).toBe("applied");
  expect(await text(page)).toContain("新视图结果");
});
test("two instances and custom toolbars share only their own assistant", async ({ page }) => {
  await mount(page, "core", true, false, true);
  await page.getByRole("button", { name: "自定义写作" }).click();
  await send(page);
  await page.evaluate(() => {
    window.writingSecond();
    const assistant = window.writingAssistant(window.writingEditors[1].editor)!;
    assistant.open();
    void assistant.send("实例二写作");
  });
  await page.waitForFunction(() => window.writingPending.length === 2);
  await page.evaluate(() => {
    window.writingAssistant(window.writingEditor.editor)!.stop();
    window.writingPending[1].resolve({ format: "text", text: "实例二结果" });
  });
  await page.waitForFunction(
    () => window.writingAssistant(window.writingEditors[1].editor)!.getSnapshot().status === "ready",
  );
  expect(await page.evaluate(() => window.writingAssistant(window.writingEditors[1].editor)!.accept())).toBe("applied");
  expect(await text(page)).toBe("原文");
  expect(await page.evaluate(() => window.writingEditors[1].getSnapshot().text)).toContain("实例二结果");
});
test("desktop and mobile inline drafts remain keyboard reachable without overflow", async ({ page }) => {
  await mount(page);
  await open(page);
  await send(page);
  await finish(page, "这是可编辑正文之外的写作草稿。\n表格、代码等结构通过 JSON 接纳。\n" + "长内容".repeat(60));
  await mkdir(resolve("test-results/writing-assistant"), { recursive: true });
  await page.screenshot({ path: resolve("test-results/writing-assistant/desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(page.getByRole("button", { name: "复制草稿", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("写作草稿", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "复制草稿", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("向智能助手提问", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "关闭写作助手" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "完成", exact: true })).toBeFocused();
  await page.screenshot({ path: resolve("test-results/writing-assistant/mobile.png"), fullPage: true });
});

test("silent low-level readonly toggles permanently invalidate a pending target", async ({ page }) => {
  await mount(page);
  await open(page);
  await send(page);
  await page.evaluate(() => {
    const editor = window.writingEditor.editor;
    editor.setEditable(false, false);
    editor.setEditable(true, false);
  });
  expect(await page.evaluate(() => window.writingPending[0].request.signal.aborted)).toBe(true);
  await page.evaluate(() => window.writingPending[0].resolve({ format: "text", text: "跨只读返回" }));
  expect(await accept(page)).toBe("unavailable");
  expect(await text(page)).toBe("原文");
});
test("an abort listener may open a new assistant session without old stop overwriting it", async ({ page }) => {
  await mount(page);
  await open(page);
  await send(page);
  await page.evaluate(() => {
    const assistant = window.writingAssistant(window.writingEditor.editor)!;
    window.writingPending[0].request.signal.addEventListener("abort", () => {
      assistant.open({ prompt: "重入会话" });
      void assistant.send("重入会话");
    });
    assistant.stop();
  });
  await page.waitForFunction(() => window.writingPending.length === 2);
  await finish(page, "重入结果", 1);
  await page.evaluate(() => window.writingPending[0].resolve({ format: "text", text: "旧会话" }));
  await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("重入结果");
  expect(await accept(page)).toBe("applied");
});

test("readonly transition blocks abort-listener sessions before the readonly flag is set", async ({ page }) => {
  await mount(page);
  await open(page);
  await send(page);
  await page.evaluate(() => {
    const editor = window.writingEditor.editor;
    const assistant = window.writingAssistant(editor)!;
    window.writingPending[0].request.signal.addEventListener("abort", () => {
      assistant.open({ prompt: "只读过渡重入" });
      void assistant.send("只读过渡重入");
    });
    editor.setEditable(false, false);
    editor.setEditable(true, false);
  });
  await page.evaluate(() => {
    for (const pending of window.writingPending) pending.resolve({ format: "text", text: "跨只读重入" });
  });
  await page.waitForFunction(
    () => window.writingAssistant(window.writingEditor.editor)!.getSnapshot().status !== "pending",
  );
  expect(await accept(page)).toBe("unavailable");
  expect(await text(page)).toBe("原文");
});

test("availability subscriptions observe replacements and may start fresh work after readonly ends", async ({
  page,
}) => {
  await mount(page);
  await open(page);
  await send(page);
  const initial = await page.evaluate(() => {
    const editor = window.writingEditor.editor;
    const assistant = window.writingAssistant(editor)!;
    let fresh = false;
    assistant.subscribe(() => {
      const state = assistant.getSnapshot();
      if (!fresh && state.available && state.status === "stale") {
        fresh = true;
        assistant.open({ prompt: "新可用期" });
        void assistant.send("新可用期");
      }
    });
    editor.setEditable(false, false);
    const during = assistant.getSnapshot().available;
    editor.setEditable(true, false);
    return { during, fresh };
  });
  expect(initial).toEqual({ during: false, fresh: true });
  await page.waitForFunction(() => window.writingPending.length === 2);
  await finish(page, "新可用期结果", 1);
  expect(await accept(page)).toBe("applied");
  const values = await page.evaluate(() => {
    const assistant = window.writingAssistant(window.writingEditor.editor)!;
    const values: boolean[] = [];
    const stop = assistant.subscribe(() => values.push(assistant.getSnapshot().available));
    window.writingUpdate(null);
    window.writingUpdate("a");
    stop();
    return values;
  });
  expect(values).toContain(false);
  expect(values.at(-1)).toBe(true);
});

test("provider context is detached from the editor's node attributes", async ({ page }) => {
  await mount(page);
  const before = await page.evaluate(() => {
    const editor = window.writingEditor.editor;
    const before = JSON.stringify(window.writingEditor.getSnapshot().json);
    window.writingAssistant(editor)!.open({ range: { from: 0, to: editor.state.doc.content.size } });
    return before;
  });
  await send(page);
  await page.evaluate(() => {
    window.writingPending[0].request.context.selection.content[0].attrs!.textAlign = "right";
  });
  expect(await page.evaluate(() => JSON.stringify(window.writingEditor.getSnapshot().json))).toBe(before);
});
test("a result getter that reenters cannot overwrite the newer session's prompt or result", async ({ page }) => {
  await mount(page);
  await open(page);
  await send(page, "旧提问");
  await page.evaluate(() => {
    const assistant = window.writingAssistant(window.writingEditor.editor)!;
    let reentered = false;
    window.writingPending[0].resolve({
      get format(): "text" {
        if (!reentered) {
          reentered = true;
          assistant.open({ prompt: "新提问" });
          void assistant.send("新提问");
        }
        return "text";
      },
      text: "旧结果",
    });
  });
  await page.waitForFunction(() => window.writingPending.length === 2);
  expect(await page.evaluate(() => window.writingAssistant(window.writingEditor.editor)!.getSnapshot().prompt)).toBe(
    "新提问",
  );
  await finish(page, "新结果", 1);
  expect(await accept(page)).toBe("applied");
  expect(await text(page)).toContain("新结果");
  expect(await text(page)).not.toContain("旧结果");
});

async function restartedSiblingList(page: Page) {
  await page.evaluate(() =>
    window.writingEditor.setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { semloEditorOrderedStyle: "decimal" },
          content: [
            {
              type: "listItem",
              attrs: { semloEditorListIndent: 0 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "父项" }] }],
            },
            {
              type: "listItem",
              attrs: { semloEditorListIndent: 1, semloEditorListRestart: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "重新起点" }] }],
            },
            {
              type: "listItem",
              attrs: { semloEditorListIndent: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "后续同级" }] }],
            },
          ],
        },
      ],
    }),
  );
}
async function siblingListState(page: Page) {
  return page.evaluate(() => {
    const editor = window.writingEditor.editor;
    const list = editor.state.doc.firstChild!;
    const items = Array.from({ length: list.childCount }, (_, index) => list.child(index));
    return {
      json: window.writingEditor.getSnapshot().json,
      texts: items.map((item) => item.textContent),
      indents: items.map((item) => item.attrs.semloEditorListIndent),
      restarts: items.map((item) => item.attrs.semloEditorListRestart),
      markers: Array.from(editor.view.dom.querySelectorAll(":scope > ol > li")).map(
        (item) => getComputedStyle(item).listStyleType,
      ),
    };
  });
}
async function openRestartedItemBelow(page: Page) {
  await page.locator(".semlo-editor-prose li > p").getByText("重新起点", { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  await expect(page.getByRole("dialog", { name: "插入内容" })).toBeVisible();
}
test("AI below a restarted list item creates a continuing sibling with one undo and redo", async ({ page }) => {
  await mount(page);
  await restartedSiblingList(page);
  const before = await siblingListState(page);
  expect(before.markers).toEqual(['"1. "', '"1.1. "', '"1.2. "']);
  await openRestartedItemBelow(page);
  await page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="ai"]').click();
  await send(page);
  await finish(page, "生成同级");
  expect(await accept(page)).toBe("applied");
  const inserted = await siblingListState(page);
  expect(inserted.texts).toEqual(["父项", "重新起点", "生成同级", "后续同级"]);
  expect(inserted.restarts).toEqual([false, true, false, false]);
  expect(inserted.indents).toEqual([0, 1, 1, 1]);
  expect(inserted.markers).toEqual(['"1. "', '"1.1. "', '"1.2. "', '"1.3. "']);
  await page.evaluate(() => window.writingEditor.editor.commands.undo());
  expect((await siblingListState(page)).json).toEqual(before.json);
  await page.evaluate(() => window.writingEditor.editor.commands.redo());
  expect(await siblingListState(page)).toEqual(inserted);
});
test("ordinary block-below insertion clears the restarted source item's per-item start", async ({ page }) => {
  await mount(page);
  await restartedSiblingList(page);
  await openRestartedItemBelow(page);
  await page
    .getByRole("dialog", { name: "插入内容" })
    .locator('.semlo-editor-card-item[data-command="status"]')
    .click();
  const inserted = await siblingListState(page);
  expect(inserted.restarts).toEqual([false, true, false, false]);
  expect(inserted.indents).toEqual([0, 1, 1, 1]);
  expect(inserted.markers).toEqual(['"1. "', '"1.1. "', '"1.2. "', '"1.3. "']);
});

test("partial paragraph replacement preserves unselected text, marks and paragraph attributes", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    window.writingEditor.setContent(
      '<p style="text-align:right"><em>前缀</em><strong>选中文字</strong><em>后缀</em></p>',
    );
    window.writingEditor.editor.commands.setTextSelection({ from: 3, to: 7 });
  });
  await open(page);
  await send(page);
  await finish(page, "改写");
  expect(await accept(page)).toBe("applied");
  const snapshot = await page.evaluate(() => window.writingEditor.getSnapshot());
  expect(snapshot.json.content).toHaveLength(1);
  expect(snapshot.json.content![0]).toMatchObject({ type: "paragraph", attrs: { textAlign: "right" } });
  await expect(page.locator(".semlo-editor-prose > p")).toHaveText("前缀改写后缀");
  await expect(page.locator(".semlo-editor-prose > p > em")).toHaveText(["前缀", "后缀"]);
  expect(
    await page.evaluate(() => ({
      from: window.writingEditor.editor.state.selection.from,
      to: window.writingEditor.editor.state.selection.to,
    })),
  ).toEqual({ from: 5, to: 5 });
  await page.keyboard.press("Delete");
  await expect(page.locator(".semlo-editor-prose > p")).toHaveText("前缀改写缀");
  await page.evaluate(() => window.writingEditor.editor.commands.undo());
  await expect(page.locator(".semlo-editor-prose > p")).toHaveText("前缀改写后缀");
  await page.evaluate(() => window.writingEditor.editor.commands.undo());
  await expect(page.locator(".semlo-editor-prose > p")).toHaveText("前缀选中文字后缀");
  await page.evaluate(() => window.writingEditor.editor.commands.redo());
  await expect(page.locator(".semlo-editor-prose > p")).toHaveText("前缀改写后缀");
});

const partialHtml = '<p style="text-align:right"><em>前缀</em><strong>选中文字</strong><em>后缀</em></p>';
async function openPartial(page: Page) {
  await page.evaluate((html) => window.writingSetContent(html), partialHtml);
  await page.waitForFunction(() => window.writingEditor.editor.state.doc.textContent === "前缀选中文字后缀");
  await page.evaluate(() => window.writingEditor.editor.commands.setTextSelection({ from: 3, to: 7 }));
  const original = await page.evaluate(() => window.writingEditor.getSnapshot().json);
  await open(page);
  return original;
}

test("append preserves the original selection, selects only the new text, and deletes without swallowing the suffix", async ({
  page,
}) => {
  await mount(page, "core", true, true);
  const original = await openPartial(page);
  await send(page, "在选区末尾追加");
  await finish(page, "追加结果");
  await page.getByRole("button", { name: "插入选区下方", exact: true }).click();
  await expect(page.locator(".semlo-editor-prose > p")).toHaveText("前缀选中文字追加结果后缀");
  await expect(page.locator(".semlo-editor-prose > p > em")).toHaveText(["前缀", "后缀"]);
  await expect(page.locator(".semlo-editor-prose > p > strong")).toHaveText("选中文字");
  expect(
    await page.evaluate(() => ({
      from: window.writingEditor.editor.state.selection.from,
      to: window.writingEditor.editor.state.selection.to,
    })),
  ).toEqual({ from: 7, to: 11 });
  const accepted = await page.evaluate(() => window.writingEditor.getSnapshot().json);
  await page.evaluate(() => window.writingEditor.editor.commands.undo());
  expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(original);
  await page.evaluate(() => window.writingEditor.editor.commands.redo());
  expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(accepted);
  await page.keyboard.press("Backspace");
  expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(original);
});

for (const [mode, acceptance] of [
  ["react", "default"],
  ["vue", "after"],
  ["solid", "default"],
] as const) {
  test(`${mode}: partial acceptance survives controlled echo without changing surrounding marks`, async ({ page }) => {
    await mount(page, mode, true, true);
    const original = await openPartial(page);
    await send(page);
    await finish(page, "框架结果");
    expect(
      await page.evaluate((mode) => window.writingAssistant(window.writingEditor.editor)!.accept(mode), acceptance),
    ).toBe("applied");
    await expect(page.locator(".semlo-editor-prose > p")).toHaveText(
      acceptance === "after" ? "前缀选中文字框架结果后缀" : "前缀框架结果后缀",
    );
    await expect(page.locator(".semlo-editor-prose > p > em")).toHaveText(["前缀", "后缀"]);
    expect(await page.evaluate(() => window.writingEditor.editor.state.doc.firstChild!.attrs.textAlign)).toBe("right");
    const result = await page.evaluate(() => window.writingEditor.getSnapshot().json);
    if (mode === "react") await committed(page, result);
    expect(await page.evaluate(() => window.writingEditor.editor.commands.undo())).toBe(true);
    if (mode === "react") await committed(page, original);
    expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(original);
    expect(await page.evaluate(() => window.writingEditor.editor.commands.redo())).toBe(true);
    if (mode === "react") await committed(page, result);
    expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(result);
  });
}

test("partial structured acceptance keeps heading, table and code wrappers with the suffix and a collapsed caret", async ({
  page,
}) => {
  await mount(page);
  const original = await openPartial(page);
  await send(page, "生成结构化块");
  await page.evaluate(() =>
    window.writingPending[0].resolve({
      format: "json",
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "生成标题" }] },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "安全表格" }] }],
                  },
                ],
              },
            ],
          },
          {
            type: "codeBlock",
            attrs: { language: "javascript" },
            content: [{ type: "text", text: "const safe = 1;" }],
          },
        ],
      },
    }),
  );
  const preview = page.getByLabel("写作草稿", { exact: true });
  await expect(preview.locator("table td")).toHaveText("安全表格");
  await expect(preview.locator("pre code")).toHaveText("const safe = 1;");
  expect(await accept(page)).toBe("applied");
  const result = await page.evaluate(() => ({
    json: window.writingEditor.getSnapshot().json,
    empty: window.writingEditor.editor.state.selection.empty,
  }));
  expect(result.json.content!.map((node) => node.type)).toEqual([
    "paragraph",
    "heading",
    "table",
    "codeBlock",
    "paragraph",
  ]);
  expect(result.json.content![1]).toMatchObject({ attrs: { level: 2 } });
  expect(result.json.content![3]).toMatchObject({ attrs: { language: "javascript" } });
  expect(result.json.content![0]).toMatchObject({
    attrs: { textAlign: "right" },
    content: [{ type: "text", text: "前缀", marks: [{ type: "italic" }] }],
  });
  expect(result.json.content![4]).toMatchObject({
    attrs: { textAlign: "right" },
    content: [{ type: "text", text: "后缀", marks: [{ type: "italic" }] }],
  });
  expect(result.empty).toBe(true);
  await page.evaluate(() => window.writingEditor.editor.commands.undo());
  expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(original);
  await page.evaluate(() => window.writingEditor.editor.commands.redo());
  expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(result.json);
});

async function committed(page: Page, content: unknown) {
  await page.waitForFunction(
    (json) =>
      window.writingCommitted?.version === window.writingCommitVersion &&
      JSON.stringify(window.writingCommitted.content) === JSON.stringify(json),
    content,
  );
}

test("append honors host refusal, provider and readonly reentry, document invalidation and nested acceptance guards", async ({
  page,
}) => {
  await mount(page);
  for (const action of ["reject", "provider", "readonly", "reenter"] as const) {
    await page.evaluate(() => {
      window.writingHost("none");
      window.writingReadonly(false);
      window.writingUpdate("a");
    });
    const original = await openPartial(page);
    await send(page);
    const index = await page.evaluate(() => window.writingPending.length - 1);
    await finish(page, `受保护草稿${action}`, index);
    await page.evaluate((action) => window.writingHost(action), action);
    const outcome = await page.evaluate(() => window.writingAssistant(window.writingEditor.editor)!.accept("after"));
    expect(["rejected", "unavailable"]).toContain(outcome);
    if (action === "reject") expect(outcome).toBe("rejected");
    expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(original);
    await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText(`受保护草稿${action}`);
    await page.getByRole("button", { name: "关闭写作助手" }).click();
  }
  await page.evaluate(() => {
    window.writingHost("none");
    window.writingReadonly(false);
  });
  await openPartial(page);
  await send(page);
  const index = await page.evaluate(() => window.writingPending.length - 1);
  await finish(page, "旧目标追加", index);
  await page.evaluate(() => window.writingSetContent("<p>新文档</p>"));
  expect(await page.evaluate(() => window.writingAssistant(window.writingEditor.editor)!.accept("after"))).toBe(
    "unavailable",
  );
  expect(await text(page)).toBe("新文档");
  await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("旧目标追加");
});

test("multiline prompts expand and collapse after generation on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await mount(page);
  await openPartial(page);
  const input = page.getByLabel("向智能助手提问", { exact: true });
  await input.fill("第一行\n第二行\n第三行\n第四行\n第五行\n第六行");
  const expanded = await input.evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollHeight }));
  expect(expanded.height).toBe(120);
  expect(expanded.scroll).toBeGreaterThan(expanded.height);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await finish(page);
  await expect(input).toHaveValue("");
  expect(await input.evaluate((element) => element.clientHeight)).toBeLessThan(45);
});

test("ready menu regenerates the original request and a blank follow-up sends a detached previous draft", async ({
  page,
}) => {
  await mount(page);
  await openPartial(page);
  await send(page, "初始指令");
  await finish(page, "初始草稿");
  const actions = page.getByRole("group", { name: "草稿操作" });
  await expect(actions.getByRole("button")).toHaveText(["替换选中内容", "插入选区下方", "重新生成", "关闭"]);
  await expect(page.getByLabel("向智能助手提问", { exact: true })).toHaveValue("");
  await actions.getByRole("button", { name: "重新生成", exact: true }).click();
  await page.waitForFunction(() => window.writingPending.length === 2);
  expect(
    await page.evaluate(() => ({
      prompt: window.writingPending[1].request.prompt,
      previous: window.writingPending[1].request.previousDraft ?? null,
      context: window.writingPending[1].request.context,
    })),
  ).toEqual(
    await page.evaluate(() => ({
      prompt: "初始指令",
      previous: null,
      context: window.writingPending[0].request.context,
    })),
  );
  await finish(page, "重新生成草稿", 1);
  await send(page, "把上一草稿精简");
  await page.waitForFunction(() => window.writingPending.length === 3);
  expect(await page.evaluate(() => window.writingPending[2].request.previousDraft)).toEqual({
    format: "text",
    text: "重新生成草稿",
  });
  await page.evaluate(() => {
    (window.writingPending[2].request.previousDraft as { format: "text"; text: string }).text = "宿主修改";
    window.writingPending[2].reject(new Error("追问失败"));
  });
  await expect(page.getByRole("region", { name: "智能写作助手" })).toHaveAttribute("data-status", "error");
  await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("重新生成草稿");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(() => window.writingPending.length === 4);
  expect(
    await page.evaluate(() => ({
      prompt: window.writingPending[3].request.prompt,
      previous: window.writingPending[3].request.previousDraft,
    })),
  ).toEqual({ prompt: "把上一草稿精简", previous: { format: "text", text: "重新生成草稿" } });
  await finish(page, "精简草稿", 3);
  await expect(page.getByLabel("向智能助手提问", { exact: true })).toHaveValue("");
  await actions.getByRole("button", { name: "重新生成", exact: true }).click();
  await page.waitForFunction(() => window.writingPending.length === 5);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "智能写作助手" })).toHaveAttribute("data-status", "stopped");
  await page.evaluate(() => window.writingPending[4].resolve({ format: "text", text: "已停止的迟到结果" }));
  await expect(page.getByLabel("写作草稿", { exact: true })).toHaveText("精简草稿");
  await expect(page.getByRole("button", { name: "复制草稿", exact: true })).toBeVisible();
  await actions.getByRole("button", { name: "关闭", exact: true }).click();
  expect(await text(page)).toBe("前缀选中文字后缀");
});

test("all observed selection presets execute explicit prompts with the saved selection context", async ({ page }) => {
  await mount(page);
  const groups = [
    ["编辑调整选中内容", ["丰富内容", "精简内容", "修改标点符号", "翻译", "继续写"]],
    ["改写口吻", ["更专业的", "更直白的", "更友好的", "非正式的"]],
    ["整理选区内容", ["提炼「摘要」", "归纳成「表格」", "转写成「代码块」"]],
    ["根据选区内容写", ["代码块", "待办", "会议纪要", "PRD"]],
  ] as const;
  let index = 0;
  for (const [group, labels] of groups)
    for (const label of labels) {
      await page.evaluate(() => window.writingEditor.editor.commands.setTextSelection({ from: 1, to: 3 }));
      await open(page);
      const menu = page.getByRole("region", { name: group, exact: true });
      await expect(menu.getByRole("button")).toHaveText([...labels]);
      if (index === 0) {
        await mkdir(resolve("test-results/writing-assistant"), { recursive: true });
        await page.screenshot({
          path: resolve("test-results/writing-assistant/selection-presets.png"),
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 780 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.setViewportSize({ width: 1280, height: 720 });
      }
      await menu.getByRole("button", { name: label, exact: true }).click();
      await page.waitForFunction((length) => window.writingPending.length === length, index + 1);
      const request = await page.evaluate(
        (index) => ({
          prompt: window.writingPending[index].request.prompt,
          selection: window.writingPending[index].request.context.selection,
          previousDraft: window.writingPending[index].request.previousDraft ?? null,
        }),
        index,
      );
      expect(request.selection).toMatchObject({ from: 1, to: 3, text: "原文" });
      expect(request.prompt.length).toBeGreaterThan(label.length);
      expect(request.previousDraft).toBeNull();
      if (label === "翻译") expect(request.prompt).toContain("英语");
      if (label.includes("表格")) expect(request.prompt).toContain("doc/table JSON");
      if (label.includes("代码块")) expect(request.prompt).toContain("doc/codeBlock JSON");
      expect(await text(page)).toBe("原文");
      await finish(page, `预设草稿${index}`, index);
      await page.getByRole("group", { name: "草稿操作" }).getByRole("button", { name: "关闭", exact: true }).click();
      expect(await text(page)).toBe("原文");
      index++;
    }
  expect(index).toBe(16);
});

test("preview never starts external resources or custom card views and leaves other editor instances untouched", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => window.writingSecond());
  await open(page);
  await send(page);
  const network: string[] = [];
  await page.route("https://writing-preview.invalid/**", (route) => {
    network.push(route.request().url());
    return route.abort();
  });
  await page.evaluate(() =>
    window.writingPending[0].resolve({
      format: "json",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "安全链接文字",
                marks: [{ type: "link", attrs: { href: "https://writing-preview.invalid/link" } }],
              },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "image", attrs: { src: "https://writing-preview.invalid/image.png" } }],
          },
        ],
      },
    }),
  );
  await expect(page.getByRole("region", { name: "智能写作助手" })).toHaveAttribute("data-status", "ready");
  const draft = page.getByLabel("写作草稿", { exact: true });
  await expect(draft).toContainText("安全链接文字");
  await expect(draft).toContainText("[image]");
  await expect(draft.locator("img,a,iframe,video,audio")).toHaveCount(0);
  expect(network).toEqual([]);
  expect(await page.evaluate(() => window.writingEditors[1].getSnapshot().text)).toBe("实例二");
  await page.getByRole("group", { name: "草稿操作" }).getByRole("button", { name: "关闭", exact: true }).click();
  expect(await text(page)).toBe("原文");
});

test("react: an undo during controlled commit cannot be overwritten by an older writing snapshot", async ({ page }) => {
  await mount(page, "react", true, true);
  const original = await openPartial(page);
  await send(page);
  await finish(page, "框架结果");
  await page.evaluate(() => {
    window.writingUndoOnCommit = "前缀框架结果后缀";
  });
  expect(await accept(page)).toBe("applied");
  await page.waitForFunction(() => window.writingCommitUndo !== null);
  await committed(page, original);
  expect(await page.evaluate(() => window.writingCommitUndo)).toBe(true);
  expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(original);
  expect(await page.evaluate(() => window.writingEditor.editor.commands.redo())).toBe(true);
  await expect(page.locator(".semlo-editor-prose > p")).toHaveText("前缀框架结果后缀");
});

test("an empty inline caret completes within its paragraph, selects new text and safely undoes or deletes it", async ({
  page,
}) => {
  await mount(page);
  const original = await page.evaluate(() => {
    window.writingEditor.setContent('<p style="text-align:right"><em>前文</em><strong>后文</strong></p>');
    window.writingEditor.editor.commands.setTextSelection(3);
    return window.writingEditor.getSnapshot().json;
  });
  await open(page);
  await send(page, "中间写作");
  expect(await page.evaluate(() => window.writingPending[0].request.context.selection)).toMatchObject({
    from: 3,
    to: 3,
    text: "",
  });
  await finish(page, "生成文字");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".semlo-editor-prose > p")).toHaveText("前文生成文字后文");
  await expect(page.locator(".semlo-editor-prose > p > em")).toHaveText("前文");
  await expect(page.locator(".semlo-editor-prose > p > strong")).toHaveText("后文");
  expect(await page.evaluate(() => window.writingEditor.editor.state.doc.firstChild!.attrs.textAlign)).toBe("right");
  expect(
    await page.evaluate(() => ({
      from: window.writingEditor.editor.state.selection.from,
      to: window.writingEditor.editor.state.selection.to,
    })),
  ).toEqual({ from: 3, to: 7 });
  const inserted = await page.evaluate(() => window.writingEditor.getSnapshot().json);
  expect(await page.evaluate(() => window.writingEditor.editor.commands.undo())).toBe(true);
  expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(original);
  expect(await page.evaluate(() => window.writingEditor.editor.commands.redo())).toBe(true);
  expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(inserted);
  await page.keyboard.press("Backspace");
  expect(await page.evaluate(() => window.writingEditor.getSnapshot().json)).toEqual(original);
});
