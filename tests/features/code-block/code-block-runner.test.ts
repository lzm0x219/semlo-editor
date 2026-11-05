import { expect, test } from "@rstest/playwright";
import type { Editor } from "@tiptap/core";

import {
  canRunCode,
  configureCodeRunner,
  runCode,
  type CodeRunRequest,
} from "../../../packages/core/src/features/code-block/runner";

function editorStub() {
  let onDestroy = () => {};
  const editor = {
    isDestroyed: false,
    on: (_event: string, listener: () => void) => {
      onDestroy = listener;
    },
    view: { dom: { ownerDocument: { defaultView: { Event } }, dispatchEvent: () => true } },
  } as unknown as Editor;
  return {
    editor,
    destroy: () => {
      (editor as unknown as { isDestroyed: boolean }).isDestroyed = true;
      onDestroy();
    },
  };
}

test("runner only receives supported normalized languages and exact source", async () => {
  const { editor } = editorStub();
  const received: CodeRunRequest[] = [];
  expect(canRunCode(editor, "js")).toBe(false);
  configureCodeRunner(
    editor,
    (request) => {
      received.push(request);
    },
    () => {},
  );
  expect(canRunCode(editor, "JS")).toBe(true);
  expect(canRunCode(editor, "py")).toBe(true);
  expect(canRunCode(editor, "c++")).toBe(true);
  expect(canRunCode(editor, "java")).toBe(true);
  expect(canRunCode(editor, "c")).toBe(true);
  expect(canRunCode(editor, "c#")).toBe(true);
  expect(canRunCode(editor, "ts")).toBe(true);
  expect(canRunCode(editor, "go")).toBe(true);
  expect(canRunCode(editor, "rust")).toBe(true);
  expect(canRunCode(editor, "php")).toBe(true);
  expect(canRunCode(editor, "html")).toBe(true);
  expect(canRunCode(editor, "sql")).toBe(true);
  expect(canRunCode(editor, "bash")).toBe(true);
  expect(canRunCode(editor, "shell")).toBe(true);
  expect(canRunCode(editor, "vb.net")).toBe(true);
  expect(canRunCode(editor, "verilog")).toBe(true);
  expect(canRunCode(editor, "systemverilog")).toBe(true);
  expect(canRunCode(editor, "ruby")).toBe(false);
  expect(canRunCode(editor, "solidity")).toBe(false);
  await runCode(editor, "JS", "const x = 1\n");
  await runCode(editor, "py", "print('hello')");
  await runCode(editor, "solidity", "ignored");
  expect(received.map(({ language, code }) => [language, code])).toEqual([
    ["javascript", "const x = 1\n"],
    ["python", "print('hello')"],
  ]);
});

test("replacement, removal and destruction abort outstanding calls and suppress stale errors", async () => {
  const { editor, destroy } = editorStub();
  const errors: unknown[] = [];
  let rejectPending: (error: Error) => void = () => {};
  let signal: AbortSignal | undefined;
  const pending = (request: CodeRunRequest) => {
    signal = request.signal;
    return new Promise<void>((_resolve, reject) => {
      rejectPending = reject;
    });
  };
  configureCodeRunner(editor, pending, (error) => errors.push(error));
  const first = runCode(editor, "python", "print(1)");
  expect(signal?.aborted).toBe(false);
  configureCodeRunner(
    editor,
    () => {},
    (error) => errors.push(error),
  );
  expect(signal?.aborted).toBe(true);
  rejectPending(new Error("stale"));
  await first;
  expect(errors).toEqual([]);
  configureCodeRunner(editor, pending, (error) => errors.push(error));
  const second = runCode(editor, "javascript", "1");
  configureCodeRunner(editor, null, (error) => errors.push(error));
  expect(signal?.aborted).toBe(true);
  rejectPending(new Error("removed"));
  await second;
  expect(canRunCode(editor, "javascript")).toBe(false);
  configureCodeRunner(editor, pending, (error) => errors.push(error));
  const third = runCode(editor, "javascript", "1");
  destroy();
  expect(signal?.aborted).toBe(true);
  rejectPending(new Error("destroyed"));
  await third;
  expect(errors).toEqual([]);
});

test("active runner failures reach the host error handler", async () => {
  const { editor } = editorStub();
  const errors: unknown[] = [];
  configureCodeRunner(
    editor,
    () => {
      throw new Error("runner failed");
    },
    (error) => errors.push(error),
  );
  await runCode(editor, "python", "print(1)");
  expect(errors).toHaveLength(1);
  expect((errors[0] as Error).message).toBe("runner failed");
});
