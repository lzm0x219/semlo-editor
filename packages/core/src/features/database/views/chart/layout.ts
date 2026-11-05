import {
  databaseChartGridColumns,
  databaseChartGridMaxHeight,
  databaseChartGridMaxY,
  normalizeDatabaseChartLayout,
  type DatabaseChart,
  type DatabaseChartLayout,
} from "../../model";

type ChartGeometry = Pick<DatabaseChart, "id" | "layout">;

function size(value: number, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.round(value))) : fallback;
}

function overlaps(a: DatabaseChartLayout, b: DatabaseChartLayout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Find the first open position by row and then column, without scanning empty rows. */
export function findChartVacancy(
  layouts: Iterable<DatabaseChartLayout>,
  width: number,
  height: number,
): DatabaseChartLayout {
  const w = size(width, 4, databaseChartGridColumns);
  const h = size(height, 4, databaseChartGridMaxHeight);
  const occupied = Array.from(layouts);
  // A first valid row can only be zero or the bottom edge of an existing card.
  const rows = [...new Set([0, ...occupied.map((item) => item.y + item.h)])].sort((a, b) => a - b);
  for (const y of rows) {
    if (y > databaseChartGridMaxY) break;
    for (let x = 0; x <= databaseChartGridColumns - w; x++) {
      const candidate = { x, y, w, h };
      if (occupied.every((other) => !overlaps(candidate, other))) return candidate;
    }
  }
  // Normalized data contains at most 100 cards of at most 500 rows, so an
  // unoccupied row must exist below them before the configured coordinate cap.
  throw new RangeError("图表画布没有可用位置");
}

/** Resolve saved positions and place cards without positions into the first available cells. */
export function resolveChartLayouts(charts: readonly ChartGeometry[]): Map<string, DatabaseChartLayout> {
  const resolved = new Map<string, DatabaseChartLayout>();
  const occupied: DatabaseChartLayout[] = [];

  for (const chart of charts) {
    const layout = normalizeDatabaseChartLayout(chart.layout);
    if (!layout) continue;
    // Imported documents may contain overlapping coordinates. Keep the first
    // card and push later conflicting cards down without changing their x.
    let y = layout.y;
    for (;;) {
      const conflicts = occupied.filter((other) => overlaps({ ...layout, y }, other));
      if (!conflicts.length) break;
      y = Math.max(...conflicts.map((other) => other.y + other.h));
    }
    const placed = y <= databaseChartGridMaxY ? { ...layout, y } : findChartVacancy(occupied, layout.w, layout.h);
    resolved.set(chart.id, placed);
    occupied.push(placed);
  }

  for (const chart of charts) {
    if (resolved.has(chart.id)) continue;
    const layout = findChartVacancy(occupied, 4, 4);
    resolved.set(chart.id, layout);
    occupied.push(layout);
  }
  // Preserve document order for callers that iterate the returned map.
  return new Map(charts.map((chart) => [chart.id, resolved.get(chart.id)!]));
}

/** Pack cards upward at their existing horizontal positions, optionally fixing one card. */
export function compactChartLayouts(
  layouts: ReadonlyMap<string, DatabaseChartLayout>,
  fixedId?: string,
): Map<string, DatabaseChartLayout> {
  const result = new Map(Array.from(layouts, ([key, layout]) => [key, { ...layout }]));
  const fixed = fixedId ? result.get(fixedId) : undefined;
  const placed: DatabaseChartLayout[] = fixed ? [fixed] : [];
  const ordered = Array.from(result.entries())
    .filter(([id]) => id !== fixedId)
    .sort(([, first], [, second]) => first.y - second.y || first.x - second.x);
  for (const [, chart] of ordered) {
    let y = 0;
    for (;;) {
      const conflicts = placed.filter((other) => overlaps({ ...chart, y }, other));
      if (!conflicts.length) break;
      y = Math.max(...conflicts.map((other) => other.y + other.h));
    }
    if (y > databaseChartGridMaxY) return new Map(Array.from(layouts, ([key, layout]) => [key, { ...layout }]));
    chart.y = y;
    placed.push(chart);
  }
  return result;
}

/** Resize from a fixed top-left corner, pushing collisions down and packing vertically. */
export function resizeChartLayouts(
  layouts: ReadonlyMap<string, DatabaseChartLayout>,
  id: string,
  nextSize: { w: number; h: number },
): Map<string, DatabaseChartLayout> {
  const result = new Map(Array.from(layouts, ([key, layout]) => [key, { ...layout }]));
  const target = result.get(id);
  if (!target) return result;
  const w = size(nextSize.w, target.w, databaseChartGridColumns - target.x);
  const h = size(nextSize.h, target.h, databaseChartGridMaxHeight);
  if (w === target.w && h === target.h) return result;
  target.w = w;
  target.h = h;
  const pending = [id];
  while (pending.length) {
    const currentId = pending.shift()!;
    const current = result.get(currentId)!;
    const ordered = Array.from(result.entries())
      .filter(([otherId, other]) => otherId !== currentId && otherId !== id && overlaps(current, other))
      .sort(([, first], [, second]) => first.y - second.y || first.x - second.x);
    for (const [otherId, other] of ordered) {
      // A previous collision in this loop may already have moved the card.
      if (!overlaps(current, other)) continue;
      const y = current.y + current.h;
      if (y > databaseChartGridMaxY) return new Map(Array.from(layouts, ([key, layout]) => [key, { ...layout }]));
      other.y = y;
      pending.push(otherId);
    }
  }
  return compactChartLayouts(result, id);
}
