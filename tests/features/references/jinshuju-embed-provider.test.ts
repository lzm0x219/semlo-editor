import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("Jinshuju embeds", () => {
  test("builds the observed form embed while preserving link parameters", () => {
    expect(resolveEmbed("jinshuju", embedProviders.jinshuju.example)).toEqual({
      url: "https://jinshuju.net/f/an1MIH",
      embedUrl: "https://jinshuju.net/f/an1MIH?background=white&banner=show&embedded=true&inner_redirect=true",
    });
    expect(resolveEmbed("jinshuju", "https://jinshuju.net/f/an1MIH?channel=demo&inner_redirect=false")?.embedUrl).toBe(
      "https://jinshuju.net/f/an1MIH?channel=demo&inner_redirect=true&background=white&banner=show&embedded=true",
    );
  });
  test("rejects other hosts, protocols and paths", () => {
    for (const url of [
      "http://jinshuju.net/f/an1MIH",
      "https://jinshuju.net.evil.test/f/an1MIH",
      "https://evil@jinshuju.net/f/an1MIH",
      "https://jinshuju.net/admin/an1MIH",
      "https://jinshuju.net/f/%2Fan1MIH",
    ])
      expect(resolveEmbed("jinshuju", url)).toBeNull();
  });
});
