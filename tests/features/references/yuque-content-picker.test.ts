import { expect, test } from "@rstest/core";

import {
  ContentPickerController,
  type ContentChoice,
  type ContentPickerProvider,
} from "../../../packages/core/src/features/references/yuque-content-picker";

const doc: ContentChoice = {
  id: "local-document",
  title: "文档",
  href: "https://example.invalid/doc",
  kind: "document",
};
const table: ContentChoice = { id: "local-table", title: "表格", href: "https://example.invalid/table", kind: "table" };

test("search and link resolution use the injected provider", async () => {
  const calls: string[] = [];
  const provider: ContentPickerProvider = {
    search: async (query) => {
      calls.push(query);
      return [doc, table];
    },
    resolveLink: async (link) => {
      calls.push(link);
      return null;
    },
  };
  const picker = new ContentPickerController(provider);
  expect(await picker.search("测试")).toEqual({ status: "ready", value: [doc, table] });
  expect(await picker.resolveLink("local-test-link")).toEqual({ status: "ready", value: null });
  expect(calls).toEqual(["测试", "local-test-link"]);
});

test("a late search result cannot replace a newer link result", async () => {
  let finish!: (value: readonly ContentChoice[]) => void;
  let signal!: AbortSignal;
  const picker = new ContentPickerController({
    search: async (_query, active) => {
      signal = active;
      return await new Promise((resolve) => {
        finish = resolve;
      });
    },
    resolveLink: async () => table,
  });
  const old = picker.search("旧搜索");
  expect(await picker.resolveLink("新链接")).toEqual({ status: "ready", value: table });
  expect(signal.aborted).toBe(true);
  finish([doc]);
  expect(await old).toEqual({ status: "superseded" });
});

test("dispose cancels pending work and blocks later operations", async () => {
  let finish!: (value: readonly ContentChoice[]) => void;
  let signal!: AbortSignal;
  const picker = new ContentPickerController({
    search: async (_query, active) => {
      signal = active;
      return await new Promise((resolve) => {
        finish = resolve;
      });
    },
    resolveLink: async () => doc,
  });
  const pending = picker.search("测试");
  picker.dispose();
  expect(signal.aborted).toBe(true);
  finish([doc]);
  expect(await pending).toEqual({ status: "superseded" });
  expect(await picker.resolveLink("新链接")).toEqual({ status: "superseded" });
});

test("provider failure is returned only while its request remains current", async () => {
  const failure = new Error("provider failure");
  const picker = new ContentPickerController({
    search: async () => {
      throw failure;
    },
    resolveLink: async () => null,
  });
  expect(await picker.search("测试")).toEqual({ status: "failed", error: failure });
});

test("synchronous abort reentry supersedes the outer request", async () => {
  let picker!: ContentPickerController;
  let finish!: (value: readonly ContentChoice[]) => void;
  let nested!: Promise<unknown>;
  const calls: string[] = [];
  picker = new ContentPickerController({
    search: async (query, signal) => {
      calls.push(query);
      if (query === "first") {
        signal.addEventListener(
          "abort",
          () => {
            nested = picker.resolveLink("nested");
          },
          { once: true },
        );
        return await new Promise((resolve) => {
          finish = resolve;
        });
      }
      return [];
    },
    resolveLink: async (link) => {
      calls.push(link);
      return doc;
    },
  });
  const first = picker.search("first");
  const outer = picker.search("outer");
  expect(await outer).toEqual({ status: "superseded" });
  expect(await nested).toEqual({ status: "ready", value: doc });
  finish([]);
  expect(await first).toEqual({ status: "superseded" });
  expect(calls).toEqual(["first", "nested"]);
});
