import type { DatabaseFieldType } from "../../model";

/** The calculated bucket shape shared with the ordinary chart aggregation. */
export interface SpecialChartBucket {
  key: string;
  label: string;
  value: number;
}

export interface FunnelLevel extends SpecialChartBucket {
  /** The individual value before any cumulative merge. */
  rawValue: number;
}

export type WordcloudWord = SpecialChartBucket;

/** Apply a saved layer order without losing categories added since it was saved. */
export function calculateFunnelLevels(
  buckets: readonly SpecialChartBucket[],
  order: readonly string[],
  cumulative: boolean,
): FunnelLevel[] {
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const used = new Set<string>();
  const ordered: SpecialChartBucket[] = [];
  for (const key of order) {
    const bucket = byKey.get(key);
    if (bucket && !used.has(key)) {
      ordered.push(bucket);
      used.add(key);
    }
  }
  for (const bucket of buckets) {
    if (!used.has(bucket.key)) {
      ordered.push(bucket);
      used.add(bucket.key);
    }
  }
  let total = 0;
  const levels: FunnelLevel[] = [];
  for (let index = ordered.length - 1; index >= 0; index--) {
    const bucket = ordered[index];
    const rawValue = Number.isFinite(bucket.value) ? bucket.value : 0;
    total += rawValue;
    levels.push({ key: bucket.key, label: bucket.label, rawValue, value: cumulative ? total : rawValue });
  }
  return levels.reverse();
}

/** Filter and count terms from buckets already filtered by the parent chart. */
export function calculateWordcloudWords(
  buckets: readonly SpecialChartBucket[],
  _fieldType: DatabaseFieldType | undefined,
  maxWords: number,
  exclude: string,
): WordcloudWord[] {
  const limit = Number.isFinite(maxWords) ? Math.max(1, Math.min(100, Math.round(maxWords))) : 20;
  const excluded = new Set(exclude.split(/\s+/u).filter(Boolean));
  const entries = new Map<string, WordcloudWord>();
  for (const bucket of buckets) {
    const label = bucket.label.trim();
    if (!label || excluded.has(label) || !Number.isFinite(bucket.value)) continue;
    const previous = entries.get(label);
    if (previous) previous.value += bucket.value;
    else entries.set(label, { key: bucket.key, label, value: bucket.value });
  }
  return [...entries.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}
