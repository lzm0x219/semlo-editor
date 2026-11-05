import { expect, test } from "@rstest/core";

import {
  InteractiveCardHostController,
  type InteractiveCardConfig,
  type InteractiveCardHost,
} from "../../../packages/core/src/features/interactive/interactive-card-host";

const config: InteractiveCardConfig = { kind: "checkin", title: "阅读", buttonLabel: "已读", deadline: null };

test("sync preserves the host failure and separately reports an observer failure during cleanup", async () => {
  const hostError = new Error("host failed");
  const observerError = new Error("observer failed");
  const reported: unknown[] = [];
  const originalReport = Object.getOwnPropertyDescriptor(globalThis, "reportError");
  Object.defineProperty(globalThis, "reportError", {
    configurable: true,
    writable: true,
    value: (error: unknown) => {
      reported.push(error);
    },
  });
  try {
    const host: InteractiveCardHost = {
      createActivity: async () => ({ cardId: "id" }),
      verifyConfiguration: async () => true,
      syncConfiguration: async () => {
        throw hostError;
      },
    };
    const controller = new InteractiveCardHostController(host);
    let calls = 0;
    controller.subscribe(() => {
      if (++calls === 2) throw observerError;
    });
    await expect(controller.sync("id", config, new AbortController().signal)).rejects.toBe(hostError);
    await Promise.resolve();
    expect(reported).toEqual([observerError]);
    expect(calls).toBe(2);
    expect(controller.isSyncing("id", "checkin")).toBe(false);
  } finally {
    if (originalReport) Object.defineProperty(globalThis, "reportError", originalReport);
    else Reflect.deleteProperty(globalThis, "reportError");
  }
});

test("an observer failure following successful sync remains visible to the caller", async () => {
  const observerError = new Error("observer failed");
  const host: InteractiveCardHost = {
    createActivity: async () => ({ cardId: "id" }),
    verifyConfiguration: async () => true,
    syncConfiguration: async () => {},
  };
  const controller = new InteractiveCardHostController(host);
  let calls = 0;
  controller.subscribe(() => {
    if (++calls === 2) throw observerError;
  });
  await expect(controller.sync("id", config, new AbortController().signal)).rejects.toBe(observerError);
  expect(controller.isSyncing("id", "checkin")).toBe(false);
});
