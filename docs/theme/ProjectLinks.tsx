import type { SocialLink } from "@rspress/core";
import { socialLinks as socialIcons } from "@rspress/core/runtime";
import { useEffect, useState } from "react";

const names: Record<string, string> = { github: "GitHub", npm: "npm", x: "X" };

function repositoryPath(link: SocialLink | undefined) {
  if (!link || link.mode !== "github-stars") return null;
  try {
    const url = new URL(link.content);
    const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)\/?$/);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || !match) return null;
    return `${match[1]}/${match[2].replace(/\.git$/, "")}`;
  } catch {
    return null;
  }
}

function formatStars(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(count);
}

export function useGithubStars(links: SocialLink[]) {
  const github = links.find((link) => typeof link.icon === "string" && link.icon.toLowerCase() === "github");
  const repo = repositoryPath(github);
  const [result, setResult] = useState<{ repo: string; count: number } | null>(null);

  useEffect(() => {
    if (!repo) return;
    const controller = new AbortController();
    fetch(`https://api.github.com/repos/${repo}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { stargazers_count?: unknown } | null) => {
        if (typeof data?.stargazers_count === "number" && Number.isSafeInteger(data.stargazers_count)) {
          setResult({ repo, count: data.stargazers_count });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [repo]);

  return result?.repo === repo ? result.count : null;
}

export function ProjectLinks({ links, stars }: { links: SocialLink[]; stars: number | null }) {
  return (
    <div className="semlo-editor-project-links" role="group" aria-label="项目链接">
      {links.map((link) => {
        if (typeof link.icon !== "string") return null;
        const icon = link.icon.toLowerCase();
        const name = names[icon];
        const svg = socialIcons[link.icon];
        if (!name || !svg) return null;
        const iconElement = (
          <span
            className="semlo-editor-project-links__icon"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        );
        let href: string | null = null;
        if (link.mode === "link" || link.mode === "github-stars") {
          try {
            const url = new URL(link.content);
            if (url.protocol === "https:") href = url.href;
          } catch {
            // An invalid destination stays unavailable.
          }
        }
        if (!href) {
          const label = `${name}：${link.mode === "text" ? link.content : "暂未配置"}`;
          return (
            <span
              className="semlo-editor-project-links__item"
              data-platform={icon}
              data-unavailable
              role="img"
              aria-label={label}
              title={label}
              key={icon}
            >
              {iconElement}
            </span>
          );
        }
        const count = icon === "github" && link.mode === "github-stars" ? stars : null;
        const label = `${name}${count === null ? "" : `，${count.toLocaleString()} 个 Star`}（在新标签页打开）`;
        return (
          <a
            className="semlo-editor-project-links__item"
            data-platform={icon}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            key={icon}
          >
            {iconElement}
            {count !== null && (
              <span className="semlo-editor-project-links__count" aria-hidden="true">
                {formatStars(count)}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
