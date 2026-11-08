import { startFixtureServer } from "./fixture-rsbuild";

export async function startCoreSourceServer() {
  return startFixtureServer("./tests/fixtures/browser/core-source-entry.ts");
}
