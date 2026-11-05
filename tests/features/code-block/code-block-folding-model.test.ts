import { expect, test } from "@rstest/playwright";
import { Mapping, StepMap } from "@tiptap/pm/transform";

import {
  normalizeFolds,
  mapFolds,
  visibleCodeLines,
  findCodeFoldables,
} from "../../../packages/core/src/features/code-block/folding";

test("fold offsets are validated, remapped and preserve visible logical line numbers", () => {
  const text = "function test() {\n  return 1;\n}\nconst next = 2;";
  const folds = normalizeFolds(
    [
      { from: 17, to: 30 },
      { from: -1, to: 5 },
      { from: 18, to: 20 },
      { from: 100, to: 101 },
    ],
    text.length,
  );
  expect(folds).toEqual([
    { from: 17, to: 30 },
    { from: 18, to: 20 },
  ]);
  expect(visibleCodeLines(text, folds)).toEqual([
    { number: 1, from: 0, to: 31 },
    { number: 4, from: 32, to: 47 },
  ]);
  const mapping = new Mapping([new StepMap([1, 0, 3])]);
  expect(mapFolds(folds, mapping, 1, 1, text.length + 3)).toEqual([
    { from: 20, to: 33 },
    { from: 21, to: 23 },
  ]);
});

test("syntax parser discovers nested folds but ignores braces in strings", async () => {
  const text = 'function outer() {\n  if (true) {\n    const s = "}";\n  }\n}';
  const folds = findCodeFoldables(text, "javascript", 1000);
  expect(folds?.map((f) => f.line)).toEqual([1, 2]);
  expect(folds?.[0].from).toBe(18);
  expect(folds?.[0].to).toBe(text.length - 1);
  expect(findCodeFoldables("plain {\ntext\n}", null)).toEqual([]);
});

test("C# and GraphQL provide nested brace folds without folding string braces", () => {
  const csharp = 'class Demo {\n  string text = "}";\n  void Run() {\n    return;\n  }\n}';
  const graphql = "query {\n  user {\n    name\n  }\n}";
  expect(findCodeFoldables(csharp, "csharp", 1000)?.map((fold) => fold.line)).toEqual([1, 3]);
  expect(findCodeFoldables(graphql, "graphql", 1000)?.map((fold) => fold.line)).toEqual([1, 2]);
});

test("GraphQL folding treats a closing brace in a hash comment as a fold boundary", () => {
  // Yuque's GraphQL code block folds the outer line only through this comment.
  const text = "query {\n  # }\n  user {\n    name\n  }\n}";
  const folds = findCodeFoldables(text, "graphql", 1000);
  expect(folds?.map(({ line, from, to }) => ({ line, from, to }))).toEqual([
    { line: 1, from: 7, to: 12 },
    { line: 3, from: 22, to: 34 },
  ]);
});

test("SQL parentheses do not create fold controls", () => {
  expect(findCodeFoldables("SELECT *\nFROM (\n  SELECT id\n  FROM users\n) AS t", "sql", 1000)).toEqual([]);
  expect(findCodeFoldables("CREATE TABLE users (\n id INT,\n name VARCHAR(255)\n);", "sql", 1000)).toEqual([]);
  expect(findCodeFoldables("BEGIN\n  SELECT 1;\nEND;", "sql", 1000)).toEqual([]);
});

test("PHP folding depends on whether the block starts with a PHP tag", () => {
  expect(findCodeFoldables("function demo() {\n  return 1;\n}", "php", 1000)?.map((fold) => fold.line)).toEqual([1]);
  expect(findCodeFoldables("<?php\nfunction demo() {\n  return 1;\n}", "php", 1000)).toEqual([]);
  expect(findCodeFoldables("\n<?php\nfunction demo() {\n  return 1;\n}", "php", 1000)).toEqual([]);
  expect(findCodeFoldables("<?php echo 1; ?>\nfunction demo() {\n  return 1;\n}", "php", 1000)).toEqual([]);
});

test("mapping retains folds after deleting a boundary character but drops an erased fold", () => {
  const fold = [{ from: 17, to: 30 }];
  expect(mapFolds(fold, new Mapping([new StepMap([30, 1, 0])]), 1, 1, 30)).toEqual([{ from: 17, to: 29 }]);
  expect(mapFolds(fold, new Mapping([new StepMap([18, 1, 0])]), 1, 1, 30)).toEqual([{ from: 17, to: 29 }]);
  expect(mapFolds(fold, new Mapping([new StepMap([18, 13, 0])]), 1, 1, 18)).toEqual([]);
});
