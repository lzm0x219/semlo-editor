import type { NormalizedSidebarGroup, SidebarData } from "@rspress/core";
import { useSidebarDynamic } from "@rspress/core/runtime";
import { Link } from "@rspress/core/theme";

function isGroup(item: SidebarData[number]): item is NormalizedSidebarGroup {
  return "items" in item && Array.isArray(item.items);
}

function isDirectory(link: string) {
  return (
    link
      .split(/[?#]/, 1)[0]
      .replace(/\.html$/, "")
      .replace(/\/$/, "") === "/documentation"
  );
}

export default function DocDirectory() {
  const [items] = useSidebarDynamic();

  return (
    <div className="semlo-editor-doc-directory">
      {items.filter(isGroup).map((group) => (
        <section key={group.text}>
          <h2>{group.text}</h2>
          <ul>
            {group.items.map((item) =>
              "link" in item && item.link && !isGroup(item) && !isDirectory(item.link) ? (
                <li key={item.link}>
                  <Link href={item.link}>{item.text}</Link>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
