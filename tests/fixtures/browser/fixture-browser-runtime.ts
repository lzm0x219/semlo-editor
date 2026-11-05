import type { Page } from "@rstest/playwright";

function bootstrapFixtureGuards() {
  if (Object.hasOwn(window, "__semloRequireFixture")) return;
  const requireFixture = (key: string) => {
    const value = Reflect.get(window, key);
    if (value === undefined || value === null) throw new Error(`Browser fixture global ${key} is not initialized`);
    return value;
  };
  Object.defineProperty(window, "__semloRequireFixture", { value: requireFixture });
  Object.defineProperty(window, "__semloRequireValue", {
    value: (value: unknown, name: string) => {
      if (value === undefined || value === null) throw new Error(`Browser fixture ${name} is not initialized`);
      return value;
    },
  });
  Object.defineProperty(window, "__semloRequireDefined", {
    value: (key: string) => {
      const value = Reflect.get(window, key);
      if (value === undefined) throw new Error(`Browser fixture global ${key} is not initialized`);
      return value;
    },
  });
  Object.defineProperty(window, "__semloRequireTableEditor", {
    value: (id: string) => {
      const editor = Reflect.get(requireFixture("tableTests"), id);
      if (editor === undefined || editor === null)
        throw new Error(`Browser fixture table editor ${id} is not initialized`);
      return editor;
    },
  });
  Object.defineProperty(window, "__semloIncrementFixture", {
    value: (key: string) => {
      const value = requireFixture(key);
      if (typeof value !== "number") throw new Error(`Browser fixture global ${key} is not a number`);
      Reflect.set(window, key, value + 1);
      return value;
    },
  });
}

export async function installFixtureGuards(page: Page) {
  await page.addInitScript(bootstrapFixtureGuards);
  await page.evaluate(bootstrapFixtureGuards);
}
