import { expect, test } from "@rstest/core";

import {
  InteractiveCardHostController,
  type InteractiveCardHost,
} from "../../../packages/core/src/features/interactive/interactive-card-host";

const config = { kind: "checkin" as const, title: "阅读", buttonLabel: "已读", deadline: null };
const host = (syncConfiguration: InteractiveCardHost["syncConfiguration"]): InteractiveCardHost => ({
  createActivity: async () => ({ cardId: "new" }),
  verifyConfiguration: async () => true,
  syncConfiguration,
});

test("a replaced host cannot block or clear its successor's pending activity", async () => {
  let finishOld!: () => void;
  let finishNew!: () => void;
  let newCalls = 0;
  const controller = new InteractiveCardHostController(
    host(
      async () =>
        new Promise<void>((resolve) => {
          finishOld = resolve;
        }),
    ),
  );
  const oldResult = controller.sync("same", config, new AbortController().signal).catch(() => "cancelled");
  await Promise.resolve();
  await Promise.resolve();
  controller.setHost(
    host(async () => {
      newCalls++;
      await new Promise<void>((resolve) => {
        finishNew = resolve;
      });
    }),
  );
  expect(controller.isSyncing("same", "checkin")).toBe(false);
  const current = controller.sync("same", config, new AbortController().signal);
  await Promise.resolve();
  await Promise.resolve();
  expect(newCalls).toBe(1);
  finishOld();
  expect(await oldResult).toBe("cancelled");
  expect(controller.isSyncing("same", "checkin")).toBe(true);
  finishNew();
  await current;
  expect(controller.isSyncing("same", "checkin")).toBe(false);
});

test("independent controllers do not share pending activity state", async () => {
  let finish!: () => void;
  const first = new InteractiveCardHostController(
    host(
      async () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const second = new InteractiveCardHostController(host(async () => {}));
  const pending = first.sync("same", config, new AbortController().signal);
  await Promise.resolve();
  await Promise.resolve();
  expect(first.isSyncing("same", "checkin")).toBe(true);
  expect(second.isSyncing("same", "checkin")).toBe(false);
  await second.sync("same", config, new AbortController().signal);
  finish();
  await pending;
});

test("abort callbacks observe the replacement host and its requests remain cancellable", async () => {
  let controller!: InteractiveCardHostController;
  let finishOld!: (value: { cardId: string }) => void;
  let finishVerify!: (value: boolean) => void;
  let verifySignal!: AbortSignal;
  let observedHost: InteractiveCardHost | null = null;
  let newVerification!: Promise<boolean>;
  const replacement: InteractiveCardHost = {
    ...host(async () => {}),
    verifyConfiguration: async (_id, _config, signal) => {
      verifySignal = signal;
      return await new Promise<boolean>((resolve) => {
        finishVerify = resolve;
      });
    },
  };
  const old: InteractiveCardHost = {
    ...host(async () => {}),
    createActivity: async (_config, _from, signal) => {
      signal.addEventListener(
        "abort",
        () => {
          observedHost = controller.getHost();
          newVerification = controller.verify("same", config, new AbortController().signal);
          void newVerification.catch(() => {});
        },
        { once: true },
      );
      return await new Promise<{ cardId: string }>((resolve) => {
        finishOld = resolve;
      });
    },
  };
  controller = new InteractiveCardHostController(old);
  const oldRequest = controller.create(config, new AbortController().signal).catch(() => "cancelled");
  controller.setHost(replacement);
  expect(observedHost).toBe(replacement);
  controller.setHost(null);
  expect(verifySignal.aborted).toBe(true);
  finishOld({ cardId: "old" });
  finishVerify(true);
  expect(await oldRequest).toBe("cancelled");
  await expect(newVerification).rejects.toThrow();
});

test("a host replacement triggered by an abort callback remains the current host", async () => {
  let controller!: InteractiveCardHostController;
  let finish!: (value: { cardId: string }) => void;
  const finalHost = host(async () => {});
  const initial: InteractiveCardHost = {
    ...host(async () => {}),
    createActivity: async (_config, _from, signal) => {
      signal.addEventListener("abort", () => controller.setHost(finalHost), { once: true });
      return await new Promise<{ cardId: string }>((resolve) => {
        finish = resolve;
      });
    },
  };
  controller = new InteractiveCardHostController(initial);
  const pending = controller.create(config, new AbortController().signal).catch(() => "cancelled");
  controller.setHost(host(async () => {}));
  expect(controller.getHost()).toBe(finalHost);
  finish({ cardId: "old" });
  expect(await pending).toBe("cancelled");
});

test("a subscriber can replace the host while a sync is being queued", async () => {
  const calls: string[] = [];
  const controller = new InteractiveCardHostController(
    host(async () => {
      calls.push("old");
    }),
  );
  let replacementSync!: Promise<void>;
  let swapped = false;
  controller.subscribe((id) => {
    if (id !== "same" || swapped) return;
    swapped = true;
    controller.setHost(
      host(async () => {
        calls.push("new");
      }),
    );
    replacementSync = controller.sync("same", config, new AbortController().signal);
  });
  const original = controller.sync("same", config, new AbortController().signal).catch(() => "cancelled");
  expect(await original).toBe("cancelled");
  await replacementSync;
  expect(calls).toEqual(["new"]);
  expect(controller.isSyncing("same", "checkin")).toBe(false);
});
