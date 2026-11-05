import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type {
  InteractiveCardConfig,
  InteractiveCardHost,
} from "../../../packages/core/src/features/interactive/interactive-card-host";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/cards/encrypted-text-fixture.ts" } },
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
  await installFixtureGuards(page);
  await page.goto(origin);
});

test("投票扩展字段经过编辑、撤销和 HTML 往返仍保留，宿主只收到既有选项契约", async ({ page }) => {
  await page.evaluate(() => {
    const editor = Reflect.get(window, "encryptedEditor") as EditorController;
    const calls: Array<{ kind: string; config: InteractiveCardConfig }> = [];
    const host: InteractiveCardHost = {
      createActivity: async () => ({ cardId: "new" }),
      verifyConfiguration: async (_id, config) => {
        calls.push({ kind: "verify", config: structuredClone(config) });
        return true;
      },
      syncConfiguration: async (_id, config) => {
        calls.push({ kind: "sync", config: structuredClone(config) });
      },
      vote: {
        getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
        submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
      },
    };
    Reflect.set(window, "voteCompatCalls", calls);
    editor.setIntegrations({ interactiveCardHost: host });
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorVote",
          attrs: {
            cardId: "vote-compat",
            title: "投票",
            options: [
              { id: "a", label: "甲", future: { color: "blue", tags: ["保留"] } },
              { id: "b", label: "乙", future: 42 },
            ],
          },
        },
      ],
    });
  });

  const readOptions = () =>
    page.evaluate(
      () => (Reflect.get(window, "encryptedEditor") as EditorController).getSnapshot().json.content![0].attrs!.options,
    );
  const original = await readOptions();
  // 等待历史分组窗口结束，使撤销单独作用于后续的选项编辑。
  await page.waitForTimeout(600);
  await page.getByLabel("选项 1", { exact: true }).fill("修改");
  expect(await readOptions()).toEqual([
    { id: "a", label: "修改", future: { color: "blue", tags: ["保留"] } },
    { id: "b", label: "乙", future: 42 },
  ]);
  await page.waitForFunction(() =>
    (Reflect.get(window, "voteCompatCalls") as Array<{ kind: string }>).some((call) => call.kind === "sync"),
  );
  const synced = await page.evaluate(
    () =>
      (Reflect.get(window, "voteCompatCalls") as Array<{ kind: string; config: InteractiveCardConfig }>).find(
        (call) => call.kind === "sync",
      )?.config,
  );
  expect(synced).toMatchObject({
    kind: "vote",
    options: [
      { id: "a", label: "修改" },
      { id: "b", label: "乙" },
    ],
  });
  if (synced?.kind !== "vote") throw new Error("缺少投票同步配置");
  expect(synced.options).toEqual([
    { id: "a", label: "修改" },
    { id: "b", label: "乙" },
  ]);

  await page.evaluate(() => (Reflect.get(window, "encryptedEditor") as EditorController).editor.commands.undo());
  expect(await readOptions()).toEqual(original);
  await page.evaluate(() => (Reflect.get(window, "encryptedEditor") as EditorController).editor.commands.redo());
  const edited = await readOptions();
  await page.evaluate(() => {
    const editor = Reflect.get(window, "encryptedEditor") as EditorController;
    editor.setContent(editor.getSnapshot().html);
  });
  expect(await readOptions()).toEqual(edited);
  await page.getByRole("button", { name: "添加选项" }).click();
  expect((await readOptions()).slice(0, 2)).toEqual(edited);
  await page.getByLabel("删除选项 2", { exact: true }).click();
  expect((await readOptions())[0]).toEqual(edited[0]);
});

test("损坏的投票选项保留原值并阻止宿主请求与编辑", async ({ page }) => {
  await page.evaluate(() => {
    const editor = Reflect.get(window, "encryptedEditor") as EditorController;
    const calls: string[] = [];
    const host: InteractiveCardHost = {
      createActivity: async () => ({ cardId: "new" }),
      verifyConfiguration: async () => {
        calls.push("verify");
        return true;
      },
      syncConfiguration: async () => {
        calls.push("sync");
      },
      vote: {
        getStatus: async () => {
          calls.push("status");
          return { canVote: true, selectedOptionIds: [] };
        },
        submitVote: async () => {
          calls.push("submit");
          return { canVote: false, selectedOptionIds: [] };
        },
      },
    };
    Reflect.set(window, "voteInvalidCalls", calls);
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorVote",
          attrs: {
            cardId: "vote-invalid",
            title: "待恢复",
            options: [
              { id: "same", label: "甲", future: "保留" },
              { id: "same", label: "重复" },
            ],
          },
        },
      ],
    });
    editor.setIntegrations({ interactiveCardHost: host });
  });
  await expect(page.getByRole("status").filter({ hasText: "投票选项数据格式不受支持" })).toBeVisible();
  await expect(page.getByRole("form", { name: "编辑投票" })).toHaveCount(0);
  const options = await page.evaluate(() => {
    const editor = Reflect.get(window, "encryptedEditor") as EditorController;
    const before = editor.getSnapshot().json.content![0].attrs!.options;
    editor.setContent(editor.getSnapshot().html);
    return { before, after: editor.getSnapshot().json.content![0].attrs!.options };
  });
  expect(options.after).toEqual(options.before);
  expect(options.after).toEqual([
    { id: "same", label: "甲", future: "保留" },
    { id: "same", label: "重复" },
  ]);
  await page.evaluate(() => (Reflect.get(window, "encryptedEditor") as EditorController).setEditable(false));
  await expect(page.getByRole("status").filter({ hasText: "投票选项数据格式不受支持" })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "voteInvalidCalls"))).toEqual([]);
});

test("损坏的投票 HTML 选项原文不会被替换为空数组", async ({ page }) => {
  const result = await page.evaluate(() => {
    const editor = Reflect.get(window, "encryptedEditor") as EditorController;
    editor.setContent(
      '<div data-semlo-editor-vote="" data-title="投票" data-options="{broken"><strong>投票</strong></div>',
    );
    const before = editor.getSnapshot().json.content![0].attrs!.options;
    editor.setContent(editor.getSnapshot().html);
    return { before, after: editor.getSnapshot().json.content![0].attrs!.options };
  });
  expect(result).toEqual({ before: "{broken", after: "{broken" });
  await expect(page.getByRole("status").filter({ hasText: "投票选项数据格式不受支持" })).toBeVisible();
});

test("相同可识别选项变为损坏载荷时中止旧验证，不继续请求投票状态", async ({ page }) => {
  await page.evaluate(() => {
    const editor = Reflect.get(window, "encryptedEditor") as EditorController;
    const calls: string[] = [];
    const host: InteractiveCardHost = {
      createActivity: async () => ({ cardId: "new" }),
      verifyConfiguration: async (_id, _config, signal) => {
        calls.push("verify");
        Reflect.set(window, "voteVerifySignal", signal);
        return new Promise<boolean>((resolve) => Reflect.set(window, "resolveVoteVerify", resolve));
      },
      syncConfiguration: async () => {
        calls.push("sync");
      },
      vote: {
        getStatus: async () => {
          calls.push("status");
          return { canVote: true, selectedOptionIds: [] };
        },
        submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
      },
    };
    Reflect.set(window, "voteTransitionCalls", calls);
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorVote",
          attrs: { cardId: "vote-pending", title: "投票", options: [{ id: "a", label: "甲" }] },
        },
      ],
    });
    editor.setIntegrations({ interactiveCardHost: host });
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "voteVerifySignal")));
  const aborted = await page.evaluate(() => {
    const editor = (Reflect.get(window, "encryptedEditor") as EditorController).editor;
    const node = editor.state.doc.firstChild!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(0, undefined, {
        ...node.attrs,
        options: [
          { id: "a", label: "甲" },
          { id: "a", label: "重复" },
        ],
      }),
    );
    return (Reflect.get(window, "voteVerifySignal") as AbortSignal).aborted;
  });
  expect(aborted).toBe(true);
  await page.evaluate(async () => {
    (Reflect.get(window, "resolveVoteVerify") as (result: boolean) => void)(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await expect(page.getByRole("status").filter({ hasText: "投票选项数据格式不受支持" })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "voteTransitionCalls"))).toEqual(["verify"]);
});
