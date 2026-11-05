import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("Yida embeds", () => {
  test("preserves the official public example and form parameters", () => {
    const url = embedProviders.yida.example;
    expect(resolveEmbed("yida", url)).toEqual({ url, embedUrl: url });
    const form = "https://www.aliwork.com/o/form_123?channel=example#section";
    expect(resolveEmbed("yida", form)).toEqual({ url: form, embedUrl: form });
  });
  test("rejects non-public paths and untrusted origins", () => {
    for (const url of [
      "http://www.aliwork.com/o/customer_cases",
      "https://www.aliwork.com.evil.test/o/customer_cases",
      "https://evil@www.aliwork.com/o/customer_cases",
      "https://www.aliwork.com/s/customer_cases",
      "https://www.aliwork.com/o/%2Fadmin",
      "https://www.aliwork.com/o/customer_cases/extra",
    ])
      expect(resolveEmbed("yida", url)).toBeNull();
  });
});
