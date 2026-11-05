import { usePage } from "@rspress/core/runtime";
import { useEffect } from "react";

/** Make horizontally overflowing examples and tables discoverable and keyboard accessible. */
export function CodeOverflow() {
  const { page } = usePage();
  useEffect(() => {
    const tables = Array.from(
      document.querySelectorAll<HTMLElement>(".semlo-editor-manual .rp-table-scroll-container"),
    );
    const attributes = new Map(
      tables.map((table) => [
        table,
        {
          tabindex: table.getAttribute("tabindex"),
          role: table.getAttribute("role"),
          label: table.getAttribute("aria-label"),
        },
      ]),
    );

    const update = () => {
      document.querySelectorAll<HTMLElement>(".semlo-editor-manual .rp-codeblock").forEach((block) => {
        const scroller = block.querySelector<HTMLElement>(".rp-codeblock__content__scroll-container");
        block.toggleAttribute(
          "data-horizontal-scroll",
          Boolean(scroller && scroller.scrollWidth > scroller.clientWidth + 1),
        );
      });
      tables.forEach((table) => {
        const overflowing = table.scrollWidth > table.clientWidth + 1;
        const original = attributes.get(table);
        table.toggleAttribute("data-horizontal-scroll", overflowing);
        if (original?.tabindex === null) {
          if (overflowing) table.setAttribute("tabindex", "0");
          else table.removeAttribute("tabindex");
        }
        if (original?.role === null) {
          if (overflowing) table.setAttribute("role", "region");
          else table.removeAttribute("role");
        }
        if (original?.label === null) {
          if (overflowing) table.setAttribute("aria-label", "表格，可使用左右方向键横向滚动");
          else table.removeAttribute("aria-label");
        }
      });
    };
    update();
    const observer = new ResizeObserver(update);
    document.querySelectorAll(".semlo-editor-manual .rp-codeblock__content__scroll-container").forEach((node) => {
      observer.observe(node);
      const code = node.querySelector("pre");
      if (code) observer.observe(code);
    });
    tables.forEach((table) => {
      observer.observe(table);
      const content = table.querySelector("table");
      if (content) observer.observe(content);
    });
    return () => {
      observer.disconnect();
      tables.forEach((table) => {
        const original = attributes.get(table);
        table.removeAttribute("data-horizontal-scroll");
        if (original?.tabindex === null) table.removeAttribute("tabindex");
        if (original?.role === null) table.removeAttribute("role");
        if (original?.label === null) table.removeAttribute("aria-label");
      });
    };
  }, [page.routePath]);
  return null;
}
