import { runCode } from "../../../packages/core/src/features/code-block/runner";
import type { InteractiveCardHostController } from "../../../packages/core/src/features/interactive/interactive-card-host";
import { createEditor } from "../../../packages/core/src/index";

type Mode = "throw" | "translation-failure" | "two-failures" | "replace" | "same-translation" | "destroy";
type Result = {
  originalError: boolean;
  secondaryError: boolean;
  isAggregate: boolean;
  hostCurrent: boolean;
  enabledAfterUpdate: boolean;
  enabledAfterRetry: boolean;
  destroyed: boolean;
  notifications: number;
  otherEditorUsable: boolean;
};
declare global {
  interface Window {
    runIntegrationUpdateFailure?: (mode: Mode) => Result;
    runRunnerAbortReentry?: () => Promise<string[]>;
    runRunnerAbortDestroy?: () => Promise<{ originalError: unknown; destroyed: boolean; shellRemoved: boolean }>;
    runRunnerAbortStartsTask?: () => Promise<{
      calls: string[];
      abortedAtStart: boolean;
      abortedOnNextChange: boolean;
    }>;
  }
}

window.runIntegrationUpdateFailure = (mode) => {
  const host = document.createElement("div");
  const otherHost = document.createElement("div");
  document.body.replaceChildren(host, otherHost);
  const controller = createEditor({ element: host, content: "<p>first</p>" });
  const other = createEditor({ element: otherHost, content: "<p>second</p>" });
  const extension = controller.editor.extensionManager.extensions.find(
    (candidate) => candidate.name === "semloEditorCheckin",
  );
  if (!extension) throw new Error("interactive extension missing");
  const interactive = extension.options.host as InteractiveCardHostController;
  const translate = async () => "translated";
  const createHost = () => ({
    createActivity: async () => ({ cardId: "card" }),
    verifyConfiguration: async () => true,
    syncConfiguration: async () => {},
  });
  const firstHost = createHost();
  const laterHost = createHost();
  const first = { interactiveCardHost: firstHost, translate };
  const later = { interactiveCardHost: laterHost, translate: mode === "same-translation" ? translate : undefined };
  const failure = new Error("host listener failed");
  const secondaryFailure = new Error("translation update failed");
  let entered = false;
  let notifications = 0;
  const unsubscribe = interactive.subscribe(() => {
    notifications++;
    if (entered) return;
    entered = true;
    if (mode === "replace" || mode === "same-translation") controller.setIntegrations(later);
    if (mode === "destroy") controller.destroy();
    if (mode === "throw" || mode === "two-failures" || mode === "destroy") throw failure;
  });
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="翻译"]');
  if (!button) throw new Error("translation button missing");
  if (mode === "translation-failure" || mode === "two-failures") {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, "disabled");
    if (!descriptor?.get || !descriptor.set) throw new Error("button disabled property missing");
    let failed = false;
    Object.defineProperty(button, "disabled", {
      configurable: true,
      get: () => descriptor.get!.call(button),
      set: (value: boolean) => {
        if (!failed) {
          failed = true;
          throw mode === "two-failures" ? secondaryFailure : failure;
        }
        descriptor.set!.call(button, value);
      },
    });
  }
  let caught: unknown;
  try {
    controller.setIntegrations(first);
  } catch (error) {
    caught = error;
  }
  const enabledAfterUpdate = !button.disabled;
  const hostCurrent =
    interactive.getHost() ===
    (mode === "replace" || mode === "same-translation" ? laterHost : mode === "destroy" ? null : firstHost);
  if (mode === "throw" || mode === "translation-failure" || mode === "two-failures") controller.setIntegrations(first);
  unsubscribe();
  const enabledAfterRetry = !button.disabled;
  const destroyed = controller.editor.isDestroyed;
  const otherEditorUsable = other.editor.commands.insertContent("X") && other.getSnapshot().text.includes("X");
  controller.destroy();
  other.destroy();
  const failures = caught instanceof AggregateError ? caught.errors : [caught];
  return {
    originalError: failures.includes(failure),
    secondaryError: failures.includes(secondaryFailure),
    isAggregate: caught instanceof AggregateError,
    hostCurrent,
    enabledAfterUpdate,
    enabledAfterRetry,
    destroyed,
    notifications,
    otherEditorUsable,
  };
};

window.runRunnerAbortReentry = async () => {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const controller = createEditor({ element: host });
  const calls: string[] = [];
  const latestRunner = async () => {
    calls.push("latest");
  };
  const originalRunner = ({ signal }: { signal: AbortSignal }) => {
    calls.push("original");
    return new Promise<void>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          controller.setIntegrations({ runCode: latestRunner });
          resolve();
        },
        { once: true },
      );
    });
  };
  controller.setIntegrations({ runCode: originalRunner });
  const running = runCode(controller.editor, "javascript", "1");
  controller.setIntegrations({
    runCode: async () => {
      calls.push("superseded");
    },
  });
  await running;
  await runCode(controller.editor, "javascript", "2");
  controller.destroy();
  return calls;
};

window.runRunnerAbortDestroy = async () => {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const controller = createEditor({ element: host });
  const originalRunner = ({ signal }: { signal: AbortSignal }) =>
    new Promise<void>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          controller.destroy();
          resolve();
        },
        { once: true },
      );
    });
  controller.setIntegrations({ runCode: originalRunner });
  const running = runCode(controller.editor, "javascript", "1");
  let originalError: unknown;
  try {
    controller.setIntegrations({ runCode: async () => {} });
  } catch (error) {
    originalError = error instanceof Error ? error.message : String(error);
  }
  await running;
  return {
    originalError,
    destroyed: controller.editor.isDestroyed,
    shellRemoved: !host.querySelector(".semlo-editor"),
  };
};

window.runRunnerAbortStartsTask = async () => {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const controller = createEditor({ element: host });
  const calls: string[] = [];
  let nextSignal: AbortSignal | undefined;
  let nextTask: Promise<void> | undefined;
  const nextRunner = ({ signal }: { signal: AbortSignal }) => {
    calls.push("new");
    nextSignal = signal;
    return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  };
  const originalRunner = ({ signal }: { signal: AbortSignal }) => {
    calls.push("old");
    return new Promise<void>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          nextTask = runCode(controller.editor, "javascript", "new");
          resolve();
        },
        { once: true },
      );
    });
  };
  controller.setIntegrations({ runCode: originalRunner });
  const oldTask = runCode(controller.editor, "javascript", "old");
  controller.setIntegrations({ runCode: nextRunner });
  if (!nextSignal || !nextTask) throw new Error("new task did not start");
  const abortedAtStart = nextSignal.aborted;
  controller.setIntegrations({});
  const abortedOnNextChange = nextSignal.aborted;
  await Promise.all([oldTask, nextTask]);
  controller.destroy();
  return { calls, abortedAtStart, abortedOnNextChange };
};
