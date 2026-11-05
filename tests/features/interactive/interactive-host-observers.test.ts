import { afterEach, beforeEach, expect, test } from "@rstest/core";

import {
  InteractiveCardHostController,
  type InteractiveCardHost,
} from "../../../packages/core/src/features/interactive/interactive-card-host";

const config = { kind: "checkin" as const, title: "标题", buttonLabel: "打卡", deadline: null };
const reported: unknown[] = [];
let previousReporter: typeof globalThis.reportError;
beforeEach(() => {
  reported.length = 0;
  previousReporter = globalThis.reportError;
  globalThis.reportError = (error) => reported.push(error);
});
afterEach(() => {
  globalThis.reportError = previousReporter;
});
const host = (syncConfiguration: InteractiveCardHost["syncConfiguration"]): InteractiveCardHost => ({
  createActivity: async () => ({ cardId: "unused" }),
  verifyConfiguration: async () => true,
  syncConfiguration,
});

test("start notification errors propagate after all listeners and prevent the write", async () => {
  const first = new Error("first");
  const second = new Error("second");
  const calls: string[] = [];
  const controller = new InteractiveCardHostController(
    host(async () => {
      calls.push("write");
    }),
  );
  controller.subscribe(() => {
    calls.push("first");
    throw first;
  });
  controller.subscribe(() => {
    calls.push("second");
    throw second;
  });
  controller.subscribe(() => {
    calls.push("last");
  });
  await expect(controller.sync("a", config, new AbortController().signal)).rejects.toBe(first);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(calls.slice(0, 3)).toEqual(["first", "second", "last"]);
  expect(calls).not.toContain("write");
  expect(controller.isSyncing("a", "checkin")).toBe(false);
  expect(reported).toEqual([second, second, first]);
});

test("an observer failure rejects promptly while an older request is pending", async () => {
  let finish!: () => void;
  const calls: string[] = [];
  const controller = new InteractiveCardHostController(
    host(async (_id, value) => {
      calls.push(value.title);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }),
  );
  const pending = controller.sync("a", config, new AbortController().signal);
  await Promise.resolve();
  await Promise.resolve();
  const error = new Error("observer");
  const unsubscribe = controller.subscribe(() => {
    throw error;
  });
  await expect(controller.sync("a", { ...config, title: "第二次" }, new AbortController().signal)).rejects.toBe(error);
  expect(controller.isSyncing("a", "checkin")).toBe(true);
  unsubscribe();
  finish();
  await pending;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(calls).toEqual(["标题"]);
  expect(controller.isSyncing("a", "checkin")).toBe(false);
});

test("completion notification preserves its exception after all listeners", async () => {
  const error = new Error("completion observer");
  const calls: string[] = [];
  const controller = new InteractiveCardHostController(
    host(async () => {
      calls.push("write");
    }),
  );
  controller.subscribe(() => {
    if (calls.includes("write")) throw error;
  });
  controller.subscribe(() => {
    calls.push("observer");
  });
  await expect(controller.sync("a", config, new AbortController().signal)).rejects.toBe(error);
  expect(calls).toEqual(["observer", "write", "observer"]);
  expect(controller.isSyncing("a", "checkin")).toBe(false);
});

test("a host failure still propagates when completion observers succeed", async () => {
  const failure = new Error("host failure");
  const controller = new InteractiveCardHostController(
    host(async () => {
      throw failure;
    }),
  );
  const events: Array<string | null> = [];
  controller.subscribe((id) => events.push(id));
  await expect(controller.sync("a", config, new AbortController().signal)).rejects.toBe(failure);
  expect(events).toEqual(["a", "a"]);
  expect(controller.isSyncing("a", "checkin")).toBe(false);
});

test("reentrant host replacement and observer failure never write to either host", async () => {
  const error = new Error("observer");
  const calls: string[] = [];
  const replacement = host(async () => {
    calls.push("new");
  });
  const controller = new InteractiveCardHostController(
    host(async () => {
      calls.push("old");
    }),
  );
  let switched = false;
  controller.subscribe((id) => {
    if (id !== null && !switched) {
      switched = true;
      controller.setHost(replacement);
    }
  });
  controller.subscribe((id) => {
    if (id !== null) throw error;
  });
  await expect(controller.sync("a", config, new AbortController().signal)).rejects.toBe(error);
  await Promise.resolve();
  await Promise.resolve();
  expect(controller.getHost()).toBe(replacement);
  expect(calls).toEqual([]);
  expect(controller.isSyncing("a", "checkin")).toBe(false);
});

test("a host failure is retained and the completion observer failure is reported", async () => {
  const failure = new Error("host failure");
  const observer = new Error("completion observer");
  let calls = 0;
  const controller = new InteractiveCardHostController(
    host(async () => {
      throw failure;
    }),
  );
  controller.subscribe(() => {
    if (++calls === 2) throw observer;
  });
  await expect(controller.sync("a", config, new AbortController().signal)).rejects.toBe(failure);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(reported).toEqual([observer]);
  expect(controller.isSyncing("a", "checkin")).toBe(false);
});

test("a failing asynchronous reporter falls back to console without replacing the original rejection", async () => {
  const first = new Error("first observer");
  const second = new Error("second observer");
  const reportingFailure = new Error("reporter failed");
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  globalThis.reportError = () => {
    throw reportingFailure;
  };
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const controller = new InteractiveCardHostController(host(async () => {}));
    controller.subscribe(() => {
      throw first;
    });
    controller.subscribe(() => {
      throw second;
    });
    await expect(controller.sync("a", config, new AbortController().signal)).rejects.toBe(first);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(logged.some((args) => args.includes(second) && args.includes(reportingFailure))).toBe(true);
    expect(logged.some((args) => args.includes(first) && args.includes(reportingFailure))).toBe(true);
  } finally {
    console.error = originalConsoleError;
  }
});
