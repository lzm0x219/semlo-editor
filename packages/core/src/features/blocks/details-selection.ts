import type { ResolvedPos } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";

export type DetailsToolbarSelection = "summary" | "summary-and-body" | "other";

function ancestorPosition(position: ResolvedPos, type: string): number | null {
  for (let depth = position.depth; depth > 0; depth--) {
    if (position.node(depth).type.name === type) return position.before(depth);
  }
  return null;
}

/** 区分折叠卡片标题及同一卡片标题、正文的跨区选区。 */
export function detailsToolbarSelection(selection: Selection): DetailsToolbarSelection {
  const fromSummary = ancestorPosition(selection.$from, "detailsSummary");
  const toSummary = ancestorPosition(selection.$to, "detailsSummary");
  if (fromSummary !== null && fromSummary === toSummary) return "summary";
  if (fromSummary === null && toSummary === null) return "other";
  const fromDetails = ancestorPosition(selection.$from, "details");
  const toDetails = ancestorPosition(selection.$to, "details");
  if (fromDetails === null || fromDetails !== toDetails) return "other";
  const body = fromSummary === null ? selection.$from : selection.$to;
  return ancestorPosition(body, "detailsContent") === null ? "other" : "summary-and-body";
}
