export const mixedRomanMarker = "semlo-mixed-roman";

const additiveSymbols = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "ⅸ"],
  [8, "ⅷ"],
  [7, "ⅶ"],
  [6, "ⅵ"],
  [5, "ⅴ"],
  [4, "ⅳ"],
  [3, "ⅲ"],
  [2, "ⅱ"],
  [1, "ⅰ"],
] as const;

/** 默认混合列表的Roman层；显式HTML i/I继续使用标准Roman。 */
export function mixedRomanLabel(value: number): string {
  // 1至100已对照原生；更大值沿用高位大写、个位Unicode的项目扩展，范围与标准Roman一致。
  if (!Number.isInteger(value) || value < 1 || value > 3999) return String(value);
  let remaining = value;
  let result = "";
  for (const [amount, symbol] of additiveSymbols) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }
  return result;
}
