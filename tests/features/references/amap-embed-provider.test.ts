import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("Amap embeds", () => {
  test("accepts the observed map homepage", () => {
    const url = "https://ditu.amap.com/";
    expect(resolveEmbed("amap", embedProviders.amap.example)).toEqual({ url, embedUrl: url });
  });
  test("preserves the coordinate link and uses the web map for its iframe", () => {
    const url =
      "https://uri.amap.com/marker?position=121.287689,31.234527&name=%E5%85%AC%E5%9B%AD&src=mypage&coordinate=gaode&callnative=1";
    expect(resolveEmbed("amap", url)).toEqual({
      url,
      embedUrl:
        "https://uri.amap.com/marker?position=121.287689%2C31.234527&name=%E5%85%AC%E5%9B%AD&src=mypage&coordinate=gaode&callnative=0&platform=pc",
    });
  });
  test("rejects spoofed hosts, ambiguous coordinates and other location link formats", () => {
    for (const url of [
      "http://ditu.amap.com/",
      "https://ditu.amap.com.evil.test/",
      "https://evil@ditu.amap.com/",
      "https://ditu.amap.com/place/B0ABC",
      "https://ditu.amap.com/?location=116,39",
      "https://ditu.amap.com/#place",
      "https://uri.amap.com.evil.test/marker?position=121,31",
      "https://uri.amap.com/marker?poiid=B0FFFAB6J2",
      "https://uri.amap.com/marker?position=121,31&poiid=B0FFFAB6J2",
      "https://uri.amap.com/marker?position=121,31&position=120,30",
      "https://uri.amap.com/marker?position=181,31",
      "https://uri.amap.com/marker?position=121,-91",
      "https://uri.amap.com/marker?position=121",
      "https://uri.amap.com/marker?position=121,31&coordinate=invalid",
    ])
      expect(resolveEmbed("amap", url)).toBeNull();
  });
});
