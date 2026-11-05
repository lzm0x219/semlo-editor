import { useActiveMatcher, useSidebarDynamic } from "@rspress/core/runtime";
import { Link } from "@rspress/core/theme-original";

export function DocContext() {
  const [items] = useSidebarDynamic();
  const match = useActiveMatcher();
  const group = items.find(
    (item) => "items" in item && item.items.some((child) => "link" in child && child.link && match(child.link)),
  );
  if (!group || !("text" in group)) return null;

  return (
    <nav className="semlo-editor-doc-context" aria-label="当前位置">
      <Link href="/introduction">文档</Link>
      <span aria-hidden="true">/</span>
      <span>{group.text}</span>
    </nav>
  );
}
