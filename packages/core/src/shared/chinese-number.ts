/** 标题和列表的中文编号使用相同的整数表达。 */
export function formatChineseNumber(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647) return String(value);
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["", "十", "百", "千"];
  const groups: number[] = [];
  for (let remaining = value; remaining > 0; remaining = Math.floor(remaining / 10000)) groups.push(remaining % 10000);
  let result = "";
  let pendingZero = false;
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex--) {
    const group = groups[groupIndex];
    if (!group) {
      if (result) pendingZero = true;
      continue;
    }
    if (result && (pendingZero || group < 1000)) result += "零";
    pendingZero = false;
    let inner = "";
    let innerZero = false;
    for (let power = 3; power >= 0; power--) {
      const digit = Math.floor(group / 10 ** power) % 10;
      if (!digit) {
        if (inner) innerZero = true;
        continue;
      }
      if (innerZero) inner += "零";
      innerZero = false;
      const omitOne = digit === 1 && power === 1 && !inner && !result;
      inner += `${omitOne ? "" : digits[digit]}${units[power]}`;
    }
    result += inner + (["", "万", "亿"][groupIndex] ?? "");
  }
  return result;
}
