import { describe, expect, test } from "@rstest/core";

import { resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("NetEase music embeds", () => {
  test("reconstructs song and player links without autoplay or arbitrary parameters", () => {
    const expected = {
      url: "https://music.163.com/#/song?id=1420830402",
      embedUrl: "https://music.163.com/outchain/player?type=2&id=1420830402&auto=0&height=66",
    };
    for (const input of [
      "https://music.163.com/#/song?id=1420830402",
      "https://music.163.com/song?id=1420830402&foo=bar",
      "https://music.163.com/outchain/player?type=2&id=1420830402&auto=1",
    ])
      expect(resolveEmbed("netease", input)).toEqual(expected);
  });
  test("rejects other origins, media types and malformed IDs", () => {
    for (const input of [
      "https://music.163.com.evil.test/song?id=1",
      "http://music.163.com/song?id=1",
      "https://evil@music.163.com/song?id=1",
      "https://music.163.com/#/playlist?id=1",
      "https://music.163.com/outchain/player?type=0&id=1",
      "https://music.163.com/song?id=0",
      "https://music.163.com/song?id=1e3",
      "https://music.163.com/#//evil.test/song?id=1",
    ])
      expect(resolveEmbed("netease", input)).toBeNull();
  });
});
