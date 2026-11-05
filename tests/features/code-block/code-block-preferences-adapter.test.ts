import { expect, test } from "@rstest/playwright";
import type { Editor } from "@tiptap/core";

import {
  configureCodePreferences,
  readCodePreferences,
  rememberCodePreferences,
} from "../../../packages/core/src/features/code-block/settings";

function editor(): Editor {
  return {} as Editor;
}

test("host preference adapters restore settings and isolate unconfigured editors", () => {
  const first = editor();
  const second = editor();
  let saved: unknown;
  configureCodePreferences(first, {
    load: () => ({ language: "python", theme: "dark", indentMode: "tab", indentWidth: 4, showLineNumbers: false }),
    save: (value) => {
      saved = value;
    },
  });
  expect(readCodePreferences(first)).toMatchObject({
    language: "python",
    theme: "dark",
    indentMode: "tab",
    indentWidth: 4,
    showLineNumbers: false,
  });
  expect(readCodePreferences(second)).toMatchObject({
    language: null,
    theme: "light",
    indentMode: "space",
    indentWidth: 2,
    showLineNumbers: true,
  });
  rememberCodePreferences(first, { language: "javascript", theme: "night-owl", indentWidth: 8, wordWrap: true });
  expect(saved).toMatchObject({ language: "javascript", theme: "night-owl", indentWidth: 8, wordWrap: true });
  expect(readCodePreferences(second).language).toBeNull();
  const third = editor();
  configureCodePreferences(third, { load: () => saved, save: () => {} });
  expect(readCodePreferences(third)).toEqual(readCodePreferences(first));
  const copy = readCodePreferences(first);
  copy.language = "ruby";
  expect(readCodePreferences(first).language).toBe("javascript");
});

test("unavailable, malformed and disabled host storage cannot break in-memory settings", () => {
  const current = editor();
  rememberCodePreferences(current, { language: "python", theme: "dark" });
  configureCodePreferences(current, {
    load: () => {
      throw new Error("unavailable");
    },
    save: () => {
      throw new Error("full");
    },
  });
  expect(readCodePreferences(current)).toMatchObject({ language: "python", theme: "dark" });
  expect(() => rememberCodePreferences(current, { language: "c++", theme: "dark", indentWidth: 4 })).not.toThrow();
  expect(readCodePreferences(current)).toMatchObject({ language: "c++", indentWidth: 4 });
  configureCodePreferences(current, { load: () => ["bad"], save: () => {} });
  expect(readCodePreferences(current).language).toBe("c++");
  configureCodePreferences(current, {
    load: () => ({ language: 42, indentWidth: 999, wordWrap: "true" }),
    save: () => {},
  });
  expect(readCodePreferences(current)).toMatchObject({
    language: null,
    theme: "light",
    indentWidth: 2,
    wordWrap: false,
  });
  configureCodePreferences(current, null);
  rememberCodePreferences(current, { language: "rust" });
  expect(readCodePreferences(current).language).toBe("rust");
});
