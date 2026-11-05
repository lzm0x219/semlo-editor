import { Solar } from "lunar-typescript";

import { dateFromISO } from "../../../../shared/date/date-utils";

/**
 * Optional Chinese calendar label for a local YYYY-MM-DD date. Calendar day
 * numbers are passed directly to the calculation so a browser's timezone
 * cannot shift the chosen day across midnight.
 *
 * Traditional lunar festivals and solar terms replace the ordinary lunar day
 * label. Solar-calendar holidays are intentionally not used: the reference
 * calendar shows the lunar date on October 1, rather than "国庆节".
 */
export function calendarLunarLabel(date: string): string {
  if (!dateFromISO(date)) return "";
  const [year, month, day] = date.split("-").map(Number);
  try {
    const lunar = Solar.fromYmd(year, month, day).getLunar();
    return lunar.getFestivals()[0] || lunar.getJieQi() || lunar.getDayInChinese();
  } catch {
    // Some historical dates are outside the underlying calendar's valid range.
    return "";
  }
}
