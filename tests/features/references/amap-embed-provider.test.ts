import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("Amap embeds", () => {
  test("accepts the observed map homepage", () => {
    const url = "https://ditu.amap.com/";
    expect(resolveEmbed("amap", embedProviders.amap.example)).toEqual({ url, embedUrl: url });
  });
  test("rejects spoofed hosts and location links whose semantics are not yet verified", () => {
    for (const url of [
      "http://ditu.amap.com/",
      "https://ditu.amap.com.evil.test/",
      "https://evil@ditu.amap.com/",
      "https://ditu.amap.com/place/B0ABC",
      "https://ditu.amap.com/?location=116,39",
      "https://ditu.amap.com/#place",
    ])
      expect(resolveEmbed("amap", url)).toBeNull();
  });
});
