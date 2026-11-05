import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("Modao embeds", () => {
  test("preserves the observed prototype screen without forwarding unrelated input", () => {
    const url = embedProviders.modao.example;
    expect(resolveEmbed("modao", url)).toEqual({ url, embedUrl: url });
    expect(
      resolveEmbed(
        "modao",
        "https://free.modao.cc/app/2cd26580a6717a147454df7470e7ec464093cba3/embed/v2?untrusted=1#screen=sk71k6d1dfxulzx",
      ),
    ).toEqual({ url, embedUrl: url });
  });
  test("rejects unrelated origins and unverified share formats", () => {
    for (const url of [
      "http://free.modao.cc/app/abcdefgh/embed/v2",
      "https://free.modao.cc.evil.test/app/abcdefgh/embed/v2",
      "https://evil@free.modao.cc/app/abcdefgh/embed/v2",
      "https://free.modao.cc/app/abcdefgh/edit",
      "https://free.modao.cc/app/%2Fabcdefgh/embed/v2",
    ])
      expect(resolveEmbed("modao", url)).toBeNull();
  });
});
