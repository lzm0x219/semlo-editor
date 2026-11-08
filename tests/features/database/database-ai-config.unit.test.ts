import { expect, test } from "@rstest/core";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import { validateDatabaseData } from "../../../packages/core/src/features/database/validation";

test("旧字段保持无 AI 配置，文本字段的版本化规则可往返", () => {
  const old = createDatabaseData();
  expect(validateDatabaseData(old).fields[0]).not.toHaveProperty("ai");
  const configured = structuredClone(old);
  Object.assign(configured.fields[0], { ai: { version: 1, mode: "custom", prompt: "按每行生成摘要" } });
  expect(validateDatabaseData(configured).fields[0]).toMatchObject({
    ai: { version: 1, mode: "custom", prompt: "按每行生成摘要" },
  });
  expect(validateDatabaseData(JSON.parse(JSON.stringify(configured)))).toEqual(configured);
});

test("无效、未知或错位的 AI 配置不会静默丢失", () => {
  for (const ai of [
    { version: 2, mode: "summary", prompt: "" },
    { version: 1, mode: "other", prompt: "" },
    { version: 1, mode: "custom", prompt: "" },
    { version: 1, mode: "custom", prompt: "x".repeat(2001) },
    { version: 1, mode: "summary", prompt: "", unknown: true },
  ]) {
    const data = createDatabaseData();
    Object.assign(data.fields[0], { ai });
    expect(() => validateDatabaseData(data)).toThrow();
  }
  const data = createDatabaseData();
  Object.assign(data.fields[1], { ai: { version: 1, mode: "summary", prompt: "" } });
  expect(() => validateDatabaseData(data)).toThrow();
});
