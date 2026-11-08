import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type { InteractiveCardHost } from "../../../packages/core/src/features/interactive/interactive-card-host";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";

let origin: string;
let closeServer: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/cards/encrypted-text-fixture.ts"));
});
afterAll(async () => closeServer?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
});

for (const kind of ["vote", "checkin"] as const) {
  test(`${kind} 损坏截止日期在 JSON 和 HTML 中保留且不会访问宿主`, async ({ page }) => {
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
        checkin: {
          getStatus: async () => {
            calls.push("checkin-status");
            return { checkedIn: false };
          },
          checkIn: async () => {
            calls.push("checkin");
            return { checkedIn: true };
          },
        },
        vote: {
          getStatus: async () => {
            calls.push("vote-status");
            return { canVote: true, selectedOptionIds: [] };
          },
          submitVote: async () => {
            calls.push("vote");
            return { canVote: false, selectedOptionIds: [] };
          },
        },
      };
      Reflect.set(window, "invalidDeadlineCalls", calls);
      editor.setIntegrations({ interactiveCardHost: host });
    });
    for (const deadline of ["2026-02-30", "", "损坏\u0000\r\n", 123, false, ["未来日期"], { future: "2099-01-01" }]) {
      const result = await page.evaluate(
        ({ kind, deadline }) => {
          const editor = Reflect.get(window, "encryptedEditor") as EditorController;
          editor.setContent({
            type: "doc",
            content: [
              {
                type: kind === "vote" ? "semloEditorVote" : "semloEditorCheckin",
                attrs: {
                  cardId: "invalid",
                  title: "损坏的活动",
                  ...(kind === "vote" ? { options: [{ id: "a", label: "甲" }] } : {}),
                  deadline,
                },
              },
            ],
          });
          const before = editor.getSnapshot();
          editor.setContent(before.html);
          return {
            before: before.json.content![0].attrs!.deadline,
            html: before.html,
            after: editor.getSnapshot().json.content![0].attrs!.deadline,
          };
        },
        { kind, deadline },
      );
      expect(result.before).toEqual(deadline);
      expect(result.after).toEqual(deadline);
      expect(result.html).toContain("截止日期格式不受支持");
      await expect(page.getByRole("status").filter({ hasText: "截止日期格式不受支持" })).toBeVisible();
      await expect(page.getByRole("form", { name: kind === "vote" ? "编辑投票" : "编辑打卡" })).toHaveCount(0);
      await page.evaluate(() => (Reflect.get(window, "encryptedEditor") as EditorController).setEditable(false));
      await expect(page.getByRole("status").filter({ hasText: "截止日期格式不受支持" })).toBeVisible();
      await page.evaluate(() => (Reflect.get(window, "encryptedEditor") as EditorController).setEditable(true));
    }
    const imported = await page.evaluate((kind) => {
      const editor = Reflect.get(window, "encryptedEditor") as EditorController;
      editor.setContent(`<div data-semlo-editor-${kind}="" data-card-id="invalid" data-deadline="坏日期"></div>`);
      const original = editor.getSnapshot();
      editor.setContent(original.html);
      return {
        before: original.json.content![0].attrs!.deadline,
        after: editor.getSnapshot().json.content![0].attrs!.deadline,
      };
    }, kind);
    expect(imported).toEqual({ before: "坏日期", after: "坏日期" });
    await expect(page.getByRole("status").filter({ hasText: "截止日期格式不受支持" })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, "invalidDeadlineCalls"))).toEqual([]);
  });

  test(`${kind} 截止日期变为损坏时取消旧验证，其他实例保持独立`, async ({ page }) => {
    await page.evaluate((kind) => {
      const first = Reflect.get(window, "encryptedEditor") as EditorController;
      const calls: string[] = [];
      const host: InteractiveCardHost = {
        createActivity: async () => ({ cardId: "new" }),
        verifyConfiguration: async (id, _config, signal) => {
          calls.push(`verify:${id}`);
          if (id !== "pending") return true;
          Reflect.set(window, "deadlineSignal", signal);
          return new Promise<boolean>((resolve) => Reflect.set(window, "resolveDeadline", resolve));
        },
        syncConfiguration: async (id) => {
          calls.push(`sync:${id}`);
        },
        checkin: {
          getStatus: async (id) => {
            calls.push(`status:${id}`);
            return { checkedIn: false };
          },
          checkIn: async () => ({ checkedIn: true }),
        },
        vote: {
          getStatus: async (id) => {
            calls.push(`status:${id}`);
            return { canVote: true, selectedOptionIds: [] };
          },
          submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
        },
      };
      const attrs = {
        cardId: "pending",
        ...(kind === "vote" ? { options: [{ id: "a", label: "甲" }] } : {}),
        deadline: null,
      };
      first.setContent({
        type: "doc",
        content: [{ type: kind === "vote" ? "semloEditorVote" : "semloEditorCheckin", attrs }],
      });
      first.setIntegrations({ interactiveCardHost: host });
      const element = document.createElement("div");
      document.body.append(element);
      const create = Reflect.get(
        window,
        "createEncryptedTestEditor",
      ) as typeof import("../../../packages/core/src/index").createEditor;
      const second = create({
        element,
        toolbar: false,
        outline: false,
        interactiveCardHost: host,
        content: {
          type: "doc",
          content: [
            { type: kind === "vote" ? "semloEditorVote" : "semloEditorCheckin", attrs: { ...attrs, cardId: "other" } },
          ],
        },
      });
      Reflect.set(window, "deadlineOther", second);
      Reflect.set(window, "deadlineCalls", calls);
    }, kind);
    await page.waitForFunction(() => Boolean(Reflect.get(window, "deadlineSignal")));
    await page.waitForFunction(() => (Reflect.get(window, "deadlineCalls") as string[]).includes("status:other"));
    const aborted = await page.evaluate(() => {
      const editor = (Reflect.get(window, "encryptedEditor") as EditorController).editor;
      const node = editor.state.doc.firstChild!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, deadline: "坏日期" }));
      return (Reflect.get(window, "deadlineSignal") as AbortSignal).aborted;
    });
    expect(aborted).toBe(true);
    await page.evaluate(async () => {
      (Reflect.get(window, "resolveDeadline") as (value: boolean) => void)(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await expect(page.getByRole("status").filter({ hasText: "截止日期格式不受支持" })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, "deadlineCalls"))).toEqual([
      "verify:pending",
      "verify:other",
      "status:other",
    ]);
    expect(
      await page.evaluate(() => (Reflect.get(window, "deadlineOther") as EditorController).editor.isDestroyed),
    ).toBe(false);
    await page.evaluate(() => (Reflect.get(window, "deadlineOther") as EditorController).destroy());
  });
}
