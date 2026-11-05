/** Events are split at week boundaries so each visible segment occupies one lane. */
export interface CalendarWeekSegment<T> {
  event: T;
  startColumn: number;
  endColumn: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export function layoutCalendarWeek<T extends { start: string; end: string }>(
  events: readonly T[],
  days: readonly string[],
): CalendarWeekSegment<T>[] {
  if (!days.length) return [];
  const first = days[0];
  const last = days[days.length - 1];
  const segments = events
    .filter((event) => event.start <= last && event.end >= first)
    .map((event) => {
      const startColumn = event.start <= first ? 0 : days.findIndex((day) => day >= event.start);
      const endColumn = event.end >= last ? days.length - 1 : days.findIndex((day) => day >= event.end);
      return { event, startColumn, endColumn, continuesBefore: event.start < first, continuesAfter: event.end > last };
    })
    // Earlier entries occupy the uppermost lane; longer entries starting on
    // the same day take precedence so short entries do not fragment them.
    .sort((a, b) => a.startColumn - b.startColumn || b.endColumn - a.endColumn);
  const laneEnds: number[] = [];
  return segments.map((segment) => {
    let lane = laneEnds.findIndex((end) => end < segment.startColumn);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = segment.endColumn;
    return { ...segment, lane };
  });
}
