import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("Youku embeds", () => {
  test("reconstructs the observed video link and player without forwarding extra parameters", () => {
    const expected = {
      url: "https://v.youku.com/v_show/id_XNDc1NDU1MTQwOA==.html",
      embedUrl: "https://player.youku.com/embed/XNDc1NDU1MTQwOA==",
    };
    expect(resolveEmbed("youku", embedProviders.youku.example)).toEqual(expected);
    expect(resolveEmbed("youku", expected.embedUrl + "?autoplay=1")).toEqual(expected);
    expect(resolveEmbed("youku", expected.url + "?untrusted=1")).toEqual(expected);
  });
  test("rejects spoofed origins, invalid paths and malformed identifiers", () => {
    for (const value of [
      "http://v.youku.com/v_show/id_Xabc.html",
      "https://v.youku.com.evil.test/v_show/id_Xabc.html",
      "https://evil@v.youku.com/v_show/id_Xabc.html",
      "https://player.youku.com/embed/Xabc/extra",
      "https://v.youku.com/v_show/id_X%2fabc.html",
      "https://v.youku.com/v_show/id_Xabc===.html",
      "javascript:alert(1)",
    ]) {
      expect(resolveEmbed("youku", value)).toBeNull();
    }
  });
});
