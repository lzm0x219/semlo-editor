import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("ProcessOn embeds", () => {
  test("accepts the observed ProcessOn embed link and drops unrelated parameters", () => {
    const url = "https://www.processon.com/embed/5d006c43e4b071ad5a206ed2";
    expect(resolveEmbed("processon", embedProviders.processon.example)).toEqual({ url, embedUrl: url });
    expect(resolveEmbed("processon", url + "?ignored=1")).toEqual({ url, embedUrl: url });
  });
  test("accepts a ProcessOn share page as itself", () => {
    const url = "https://www.processon.com/view/link/5d006c43e4b0a65d8096b3d8";
    expect(resolveEmbed("processon", url)).toEqual({ url, embedUrl: url });
  });
  test("rejects dangerous hosts and paths", () => {
    for (const url of [
      "http://www.processon.com/embed/5d006c43e4b071ad5a206ed2",
      "https://processon.com.evil.test/embed/5d006c43e4b071ad5a206ed2",
      "https://evil@processon.com/embed/5d006c43e4b071ad5a206ed2",
      "https://processon.com/embed/abc%2Fdef",
      "https://processon.com/embed/5d006c43e4b071ad5a206ed2/extra",
    ])
      expect(resolveEmbed("processon", url)).toBeNull();
  });
});
