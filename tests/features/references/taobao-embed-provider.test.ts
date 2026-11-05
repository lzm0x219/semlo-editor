import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("Taobao video embeds", () => {
  test("accepts the observed direct MP4 link and preserves signed query parameters", () => {
    const url = `${embedProviders.taobao.example}?token=example`;
    expect(resolveEmbed("taobao", url)).toEqual({ url, embedUrl: url });
  });
  test("rejects unrelated hosts, credentials, unsafe and unverified formats", () => {
    for (const url of [
      "http://cloud.video.taobao.com/play/u/1/p/1/e/6/t/1/2.mp4",
      "https://cloud.video.taobao.com.evil.test/play/u/1/p/1/e/6/t/1/2.mp4",
      "https://evil@cloud.video.taobao.com/play/u/1/p/1/e/6/t/1/2.mp4",
      "https://cloud.video.taobao.com/play/u/1/p/1/e/6/t/1/2.swf",
      "https://cloud.video.taobao.com/play/u/1/p/1/e/6/t/1/%2F.mp4",
    ])
      expect(resolveEmbed("taobao", url)).toBeNull();
  });
});
