/** Link conversion is intentionally limited to providers with a known embed URL. */
export type EmbedProvider =
  | "bilibili"
  | "codepen"
  | "figma"
  | "netease"
  | "youku"
  | "canva"
  | "processon"
  | "juejin"
  | "taobao"
  | "modao"
  | "jinshuju"
  | "amap"
  | "yida";

export interface EmbedTarget {
  /** Canonical link for opening or converting the card back into a link. */
  url: string;
  /** Provider-controlled iframe URL; never taken verbatim from document data. */
  embedUrl: string;
}

export const embedProviders: Record<EmbedProvider, { label: string; placeholder: string; example: string }> = {
  bilibili: {
    label: "哔哩哔哩",
    placeholder: "粘贴哔哩哔哩链接，如 https://www.bilibili.com...",
    example: "https://www.bilibili.com/video/av55895675",
  },
  codepen: {
    label: "CodePen",
    placeholder: "粘贴 CodePen 链接，如 https://codepen.io/...",
    // Public example linked from CodePen's own embed documentation.
    example: "https://codepen.io/Mamboleoo/pen/XWJPxpZ",
  },
  figma: {
    label: "Figma",
    placeholder: "粘贴 Figma 文件或原型链接，如 https://www.figma.com/design/...",
    // Example file published in Figma's Embed Kit documentation.
    example: "https://www.figma.com/design/nrPSsILSYjesyc5UHjYYa4",
  },
  netease: {
    label: "网易云音乐",
    placeholder: "粘贴网易云音乐歌曲链接，如 https://music.163.com/...",
    example: "https://music.163.com/#/song?id=1420830402",
  },
  youku: {
    label: "优酷",
    placeholder: "粘贴优酷视频链接，如 https://v.youku.com/...",
    example: "https://v.youku.com/v_show/id_XNDc1NDU1MTQwOA==.html",
  },
  canva: {
    label: "Canva",
    placeholder: "粘贴 Canva 设计的嵌入链接，如 https://www.canva.cn/design/...",
    example: "https://www.canva.cn/design/DAD3c63mhHU/view?embed",
  },
  processon: {
    label: "ProcessOn",
    placeholder: "粘贴 ProcessOn 分享或嵌入链接，如 https://www.processon.com/embed/...",
    example: "https://www.processon.com/embed/5d006c43e4b071ad5a206ed2",
  },
  juejin: {
    label: "码上掘金",
    placeholder: "粘贴码上掘金作品链接，如 https://code.juejin.cn/pen/...",
    example: "https://code.juejin.cn/pen/7111233570496053255",
  },
  taobao: {
    label: "淘宝视频",
    placeholder: "粘贴淘宝视频链接，如 https://cloud.video.taobao.com/...",
    example: "https://cloud.video.taobao.com/play/u/1804320196/p/1/e/6/t/1/287344840104.mp4",
  },
  modao: {
    label: "墨刀",
    placeholder: "粘贴墨刀原型的嵌入链接，如 https://free.modao.cc/app/.../embed/v2",
    example: "https://free.modao.cc/app/2cd26580a6717a147454df7470e7ec464093cba3/embed/v2#screen=sk71k6d1dfxulzx",
  },
  jinshuju: {
    label: "金数据",
    placeholder: "粘贴金数据链接，如 https://jinshuju.net/f/...",
    example: "https://jinshuju.net/f/an1MIH",
  },
  amap: {
    label: "高德地图",
    placeholder: "粘贴高德地图链接，如 https://ditu.amap.com/",
    example: "https://ditu.amap.com/",
  },
  yida: {
    label: "宜搭",
    placeholder: "粘贴宜搭免登录链接，如 https://www.aliwork.com/o/...",
    // Public example in the official documentation for third-party embedding.
    example: "https://www.aliwork.com/o/customer_cases",
  },
};

export function isEmbedProvider(value: unknown): value is EmbedProvider {
  return (
    value === "bilibili" ||
    value === "codepen" ||
    value === "figma" ||
    value === "netease" ||
    value === "youku" ||
    value === "canva" ||
    value === "processon" ||
    value === "juejin" ||
    value === "taobao" ||
    value === "modao" ||
    value === "jinshuju" ||
    value === "amap" ||
    value === "yida"
  );
}

/**
 * Validate the complete origin and construct the iframe URL from validated
 * path and query fields. Do not let HTML/JSON data supply an arbitrary iframe.
 */
export function resolveEmbed(provider: unknown, value: unknown): EmbedTarget | null {
  if (!isEmbedProvider(provider) || typeof value !== "string") return null;
  if (
    value.length > 2048 ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return null;
  const input = value.trim();
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;

  if (provider === "codepen") {
    if (url.hostname !== "codepen.io") return null;
    const match = /^\/([a-zA-Z0-9_-]{1,40})\/(?:pen|embed)\/([a-zA-Z0-9]{1,32})\/?$/.exec(url.pathname);
    if (!match) return null;
    const [, user, slug] = match;
    return {
      url: `https://codepen.io/${user}/pen/${slug}`,
      embedUrl: `https://codepen.io/${user}/embed/${slug}`,
    };
  }

  if (provider === "figma") {
    if (!["figma.com", "www.figma.com", "embed.figma.com"].includes(url.hostname)) return null;
    const match = /^\/(file|design|board|proto|slides|deck)\/([a-zA-Z0-9]{1,128})(?:\/[^/]+)?\/?$/.exec(url.pathname);
    if (!match) return null;
    const path = `/${match[1]}/${match[2]}`;
    const canonical = new URL(`https://www.figma.com${path}`);
    const embed = new URL(`https://embed.figma.com${path}`);
    for (const key of ["node-id", "starting-point-node-id"]) {
      const value = url.searchParams.get(key);
      if (value && /^[0-9]+[:-][0-9]+$/.test(value)) {
        canonical.searchParams.set(key, value);
        embed.searchParams.set(key, value);
      }
    }
    embed.searchParams.set("embed-host", "semlo");
    return { url: canonical.href, embedUrl: embed.href };
  }

  if (provider === "netease") {
    if (url.hostname !== "music.163.com") return null;
    let song: URL;
    try {
      song = url.hash.startsWith("#/") ? new URL(url.hash.slice(1), url.origin) : url;
    } catch {
      return null;
    }
    if (song.origin !== url.origin || (song.pathname !== "/song" && song.pathname !== "/outchain/player")) return null;
    if (song.pathname === "/outchain/player" && song.searchParams.get("type") !== "2") return null;
    const id = song.searchParams.get("id");
    if (!id || !/^[1-9]\d{0,19}$/.test(id)) return null;
    return {
      url: `https://music.163.com/#/song?id=${id}`,
      embedUrl: `https://music.163.com/outchain/player?type=2&id=${id}&auto=0&height=66`,
    };
  }

  if (provider === "youku") {
    let match: RegExpExecArray | null = null;
    if (url.hostname === "v.youku.com") match = /^\/v_show\/id_(X[a-zA-Z0-9_-]{1,126}={0,2})\.html$/.exec(url.pathname);
    else if (url.hostname === "player.youku.com")
      match = /^\/embed\/(X[a-zA-Z0-9_-]{1,126}={0,2})\/?$/.exec(url.pathname);
    if (!match) return null;
    const id = match[1];
    return { url: `https://v.youku.com/v_show/id_${id}.html`, embedUrl: `https://player.youku.com/embed/${id}` };
  }

  if (provider === "canva") {
    if (!["www.canva.cn", "canva.cn", "www.canva.com", "canva.com"].includes(url.hostname)) return null;
    const match = /^\/design\/([a-zA-Z0-9_-]{1,128})(?:\/([a-zA-Z0-9_-]{1,128}))?\/view\/?$/.exec(url.pathname);
    if (!match) return null;
    const path = `/design/${match[1]}${match[2] ? `/${match[2]}` : ""}/view`;
    const canonical = `https://${url.hostname}${path}`;
    return { url: canonical, embedUrl: `${canonical}?embed` };
  }

  if (provider === "processon") {
    if (!["processon.com", "www.processon.com"].includes(url.hostname)) return null;
    const match = /^\/(embed|view\/link)\/([a-zA-Z0-9_-]{8,128})\/?$/.exec(url.pathname);
    if (!match) return null;
    const canonical = `https://www.processon.com/${match[1]}/${match[2]}`;
    return { url: canonical, embedUrl: canonical };
  }

  if (provider === "juejin") {
    if (url.hostname !== "code.juejin.cn") return null;
    const match = /^\/pen\/([1-9]\d{0,24})\/?$/.exec(url.pathname);
    if (!match) return null;
    const canonical = `https://code.juejin.cn/pen/${match[1]}`;
    return { url: canonical, embedUrl: `${canonical}?embed=true` };
  }

  if (provider === "taobao") {
    if (url.hostname !== "cloud.video.taobao.com") return null;
    if (!/^\/play\/u\/\d+\/p\/\d+\/e\/\d+\/t\/\d+\/\d+\.mp4$/.test(url.pathname)) return null;
    url.hash = "";
    return { url: url.href, embedUrl: url.href };
  }

  if (provider === "modao") {
    if (url.hostname !== "free.modao.cc") return null;
    const match = /^\/app\/([a-zA-Z0-9_-]{8,128})\/embed\/v2\/?$/.exec(url.pathname);
    if (!match) return null;
    const hash = /^#screen=([a-zA-Z0-9_-]{1,128})$/.exec(url.hash);
    const canonical = `https://free.modao.cc/app/${match[1]}/embed/v2${hash ? `#screen=${hash[1]}` : ""}`;
    return { url: canonical, embedUrl: canonical };
  }

  if (provider === "jinshuju") {
    if (url.hostname !== "jinshuju.net") return null;
    if (!/^\/f\/[a-zA-Z0-9_-]{1,128}\/?$/.test(url.pathname)) return null;
    url.hash = "";
    const embed = new URL(url.href);
    embed.searchParams.set("background", "white");
    embed.searchParams.set("banner", "show");
    embed.searchParams.set("embedded", "true");
    embed.searchParams.set("inner_redirect", "true");
    return { url: url.href, embedUrl: embed.href };
  }

  if (provider === "amap") {
    // The observed Yuque example is the map homepage. Point-specific links
    // require a separate verified contract; don't silently discard a location.
    if (url.hostname !== "ditu.amap.com" || url.pathname !== "/" || url.search || url.hash) return null;
    return { url: "https://ditu.amap.com/", embedUrl: "https://ditu.amap.com/" };
  }

  if (provider === "yida") {
    if (!["www.aliwork.com", "demo.aliwork.com"].includes(url.hostname)) return null;
    if (!/^\/o\/[a-zA-Z0-9_-]{1,128}\/?$/.test(url.pathname)) return null;
    return { url: url.href, embedUrl: url.href };
  }

  let identifier: { kind: "bvid" | "aid"; value: string } | undefined;
  if (url.hostname === "player.bilibili.com" && url.pathname === "/player.html") {
    const bvid = url.searchParams.get("bvid");
    const aid = url.searchParams.get("aid");
    if (bvid && /^BV[a-zA-Z0-9]{10}$/.test(bvid)) identifier = { kind: "bvid", value: bvid };
    else if (aid && /^[1-9]\d{0,19}$/.test(aid)) identifier = { kind: "aid", value: aid };
  } else if (["www.bilibili.com", "bilibili.com", "m.bilibili.com"].includes(url.hostname)) {
    const match = /^\/video\/(BV[a-zA-Z0-9]{10}|av[1-9]\d{0,19})\/?$/.exec(url.pathname);
    if (match) {
      const value = match[1];
      identifier = value.startsWith("BV") ? { kind: "bvid", value } : { kind: "aid", value: value.slice(2) };
    }
  }
  if (!identifier) return null;
  const pageValue = url.searchParams.get(url.hostname === "player.bilibili.com" ? "page" : "p");
  const page = pageValue && /^[1-9]\d{0,3}$/.test(pageValue) ? pageValue : null;
  const canonical = new URL(
    `https://www.bilibili.com/video/${identifier.kind === "aid" ? "av" : ""}${identifier.value}`,
  );
  const embed = new URL("https://player.bilibili.com/player.html");
  embed.searchParams.set(identifier.kind, identifier.value);
  if (page) {
    canonical.searchParams.set("p", page);
    embed.searchParams.set("page", page);
  }
  embed.searchParams.set("autoplay", "0");
  return { url: canonical.href, embedUrl: embed.href };
}
