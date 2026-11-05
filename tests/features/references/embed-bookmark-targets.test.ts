import { expect, test } from "@rstest/core";

import {
  embedProviders,
  resolveEmbed,
  type EmbedProvider,
} from "../../../packages/core/src/features/references/embed-providers";

test("bookmark canonical links reconstruct the same validated embed address", () => {
  const inputs: Array<[EmbedProvider, string]> = Object.entries(embedProviders).map(([provider, data]) => [
    provider as EmbedProvider,
    data.example,
  ]);
  inputs.push(
    ["bilibili", "https://www.bilibili.com/video/av55895675?p=2"],
    ["figma", "https://www.figma.com/proto/abc123/example?node-id=5-3&starting-point-node-id=1%3A2"],
    ["jinshuju", "https://jinshuju.net/f/an1MIH?channel=demo"],
    ["yida", "https://www.aliwork.com/o/customer_cases?channel=demo#section"],
  );
  for (const [provider, input] of inputs) {
    const target = resolveEmbed(provider, input);
    expect(target, `${provider}: ${input}`).not.toBeNull();
    expect(resolveEmbed(provider, target!.url), `${provider}: canonical reconstruction`).toEqual(target);
  }
});
