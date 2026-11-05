import { expect, test } from "@rstest/core";
import { Schema, Slice, Fragment } from "@tiptap/pm/model";

import {
  InteractiveCardHostController,
  stripCopiedActivityIds,
  type InteractiveCardHost,
  type InteractiveCardConfig,
} from "../../../packages/core/src/features/interactive/interactive-card-host";

const config: InteractiveCardConfig = { kind: "checkin", title: "阅读", buttonLabel: "已读", deadline: null };
function makeHost(overrides: Partial<InteractiveCardHost> = {}): InteractiveCardHost {
  return {
    createActivity: async () => ({ cardId: "new" }),
    verifyConfiguration: async () => true,
    syncConfiguration: async () => {},
    checkin: { getStatus: async () => ({ checkedIn: false }), checkIn: async () => ({ checkedIn: true }) },
    vote: {
      getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
      submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
    },
    ...overrides,
  };
}

test("creation requires a host and an independent ID for a copy", async () => {
  const controller = new InteractiveCardHostController();
  const signal = new AbortController().signal;
  await expect(controller.create(config, signal)).rejects.toThrow();
  controller.setHost(makeHost({ createActivity: async () => ({ cardId: "old" }) }));
  await expect(controller.create(config, signal, "old")).rejects.toThrow();
  controller.setHost(makeHost());
  await expect(controller.create(config, signal, "old")).resolves.toBe("new");
});

test("replacing host invalidates even an uncancellable pending creation", async () => {
  let finish!: (result: { cardId: string }) => void;
  let observed!: AbortSignal;
  const controller = new InteractiveCardHostController(
    makeHost({
      createActivity: async (_config, _from, signal) => {
        observed = signal;
        return await new Promise((resolve) => {
          finish = resolve;
        });
      },
    }),
  );
  const pending = controller.create(config, new AbortController().signal);
  controller.setHost(makeHost());
  expect(observed.aborted).toBe(true);
  finish({ cardId: "old-service-id" });
  await expect(pending).rejects.toThrow();
});

test("local syncs are serialized and report their pending status", async () => {
  const calls: string[] = [];
  const finish: Array<() => void> = [];
  const controller = new InteractiveCardHostController(
    makeHost({
      syncConfiguration: async (_id, value) => {
        calls.push(value.title);
        await new Promise<void>((resolve) => finish.push(resolve));
      },
    }),
  );
  const signal = new AbortController().signal;
  const first = controller.sync("one", config, signal);
  const second = controller.sync("one", { ...config, title: "新标题" }, signal);
  expect(controller.isSyncing("one", "checkin")).toBe(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual(["阅读"]);
  finish[0]();
  await first;
  await Promise.resolve();
  expect(calls).toEqual(["阅读", "新标题"]);
  finish[1]();
  await second;
  expect(controller.isSyncing("one", "checkin")).toBe(false);
});

test("clipboard copy removes activity IDs from nested cards", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      container: { group: "block", content: "block+" },
      semloEditorVote: { group: "block", attrs: { cardId: { default: null } }, atom: true },
      semloEditorCheckin: { group: "block", attrs: { cardId: { default: null } }, atom: true },
      text: { group: "inline" },
    },
  });
  const container = schema.nodes.container.create(null, [
    schema.nodes.semloEditorVote.create({ cardId: "vote" }),
    schema.nodes.semloEditorCheckin.create({ cardId: "checkin" }),
  ]);
  const copied = stripCopiedActivityIds(new Slice(Fragment.from(container), 0, 0));
  expect(copied.content.firstChild!.child(0).attrs.cardId).toBeNull();
  expect(copied.content.firstChild!.child(1).attrs.cardId).toBeNull();
  expect(container.child(0).attrs.cardId).toBe("vote");
});
