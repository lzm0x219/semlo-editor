import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("Canva embeds", () => {
  test("preserves the design and share token while reconstructing the embed URL", () => {
    expect(resolveEmbed("canva", embedProviders.canva.example)).toEqual({
      url: "https://www.canva.cn/design/DAD3c63mhHU/view",
      embedUrl: "https://www.canva.cn/design/DAD3c63mhHU/view?embed",
    });
    expect(
      resolveEmbed("canva", "https://www.canva.com/design/DACL-CgO2NA/ybPLSlaEaBqein2rb-ohaw/view?foo=bar"),
    ).toEqual({
      url: "https://www.canva.com/design/DACL-CgO2NA/ybPLSlaEaBqein2rb-ohaw/view",
      embedUrl: "https://www.canva.com/design/DACL-CgO2NA/ybPLSlaEaBqein2rb-ohaw/view?embed",
    });
  });
  test("rejects spoofed domains, credentials, invalid schemes and paths", () => {
    for (const url of [
      "https://www.canva.cn.evil.test/design/id/view",
      "http://www.canva.cn/design/id/view",
      "https://evil@canva.cn/design/id/view",
      "https://www.canva.cn/design/id/edit",
      "https://www.canva.cn/design/%2Fid/view",
      "https://www.canva.cn/design/id/a/b/view",
    ])
      expect(resolveEmbed("canva", url)).toBeNull();
  });
});
