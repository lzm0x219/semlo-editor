import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("third-party embed URLs", () => {
  test("reconstructs CodePen embeds using only validated owner and pen IDs", () => {
    expect(resolveEmbed("codepen", " https://codepen.io/afc163-1472555193/pen/oNXqWGP?anything=ignored ")).toEqual({
      url: "https://codepen.io/afc163-1472555193/pen/oNXqWGP",
      embedUrl: "https://codepen.io/afc163-1472555193/embed/oNXqWGP",
    });
    expect(resolveEmbed("codepen", "https://codepen.io/Mamboleoo/embed/XWJPxpZ#result")).toEqual({
      url: "https://codepen.io/Mamboleoo/pen/XWJPxpZ",
      embedUrl: "https://codepen.io/Mamboleoo/embed/XWJPxpZ",
    });
    expect(resolveEmbed("codepen", embedProviders.codepen.example)).not.toBeNull();
  });

  test("reconstructs Bilibili video and player links without passing arbitrary query fields", () => {
    expect(resolveEmbed("bilibili", "https://www.bilibili.com/video/av55895675?p=2&autoplay=1")).toEqual({
      url: "https://www.bilibili.com/video/av55895675?p=2",
      embedUrl: "https://player.bilibili.com/player.html?aid=55895675&page=2&autoplay=0",
    });
    expect(resolveEmbed("bilibili", "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=1")).toEqual({
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      embedUrl: "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0",
    });
    expect(resolveEmbed("bilibili", embedProviders.bilibili.example)?.embedUrl).toBe(
      "https://player.bilibili.com/player.html?aid=55895675&autoplay=0",
    );
  });

  test("rejects unrelated hosts, dangerous protocols, credentials and invalid identifiers", () => {
    const invalid = [
      ["codepen", "https://example.com/test"],
      ["codepen", "http://codepen.io/a/pen/abc"],
      ["codepen", "https://codepen.io.evil.example/a/pen/abc"],
      ["codepen", "https://evil.example@codepen.io/a/pen/abc"],
      ["codepen", "https://codepen.io:444/a/pen/abc"],
      ["codepen", "https://codepen.io/a/full/abc"],
      ["codepen", "https://codepen.io/a/pen/%2fabc"],
      ["codepen", "javascript:alert(1)"],
      ["codepen", "https://codepen.io/a/pen/abc\n"],
      ["bilibili", "https://www.bilibili.com.evil.example/video/av123"],
      ["bilibili", "https://player.bilibili.com.evil.example/player.html?aid=123"],
      ["bilibili", "https://bilibili.com/video/BV1bad"],
      ["bilibili", "https://player.bilibili.com/player.html?aid=0"],
      ["bilibili", "https://www.bilibili.com/video/av123/extra"],
      ["bilibili", "data:text/html,alert(1)"],
      ["unknown", embedProviders.codepen.example],
    ] as const;
    for (const [provider, url] of invalid) expect(resolveEmbed(provider, url), url).toBeNull();
  });
});
