import { resolve } from "node:path";

import { dev } from "@rspress/core";

import config from "../../../docs/rspress.config.ts";

const root = resolve("docs/site");
const server = await dev({
  docDirectory: root,
  config: { ...config, root },
  extraBuilderConfig: {
    server: { host: "127.0.0.1", port: 0, strictPort: true },
    dev: { hmr: false, liveReload: false },
  },
});

const port: unknown = Reflect.get(server, "port");
if (typeof port !== "number") throw new Error("Documentation server did not report its port");
process.send?.({ port });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(0);
}
process.on("message", (message) => {
  if (message === "stop") void close();
});
process.on("disconnect", () => void close());
