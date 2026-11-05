import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("Juejin embeds", () => {
  test("reconstructs the observed pen and its embed URL", () => {
    const url = "https://code.juejin.cn/pen/7111233570496053255";
    const target = { url, embedUrl: `${url}?embed=true` };
    expect(resolveEmbed("juejin", embedProviders.juejin.example)).toEqual(target);
    expect(resolveEmbed("juejin", `${url}?embed=true&ignored=1`)).toEqual(target);
  });
  test("rejects unrelated hosts and paths", () => {
    for (const url of [
      "http://code.juejin.cn/pen/123",
      "https://code.juejin.cn.evil.test/pen/123",
      "https://evil@code.juejin.cn/pen/123",
      "https://code.juejin.cn/pen/0",
      "https://code.juejin.cn/pen/%2f123",
      "https://code.juejin.cn/pen/123/other",
    ])
      expect(resolveEmbed("juejin", url)).toBeNull();
  });
});
