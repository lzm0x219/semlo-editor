/** Validate explicit ancestor values for a flat ordered-list fragment. */
export function normalizeOrderedAncestorPath(value: unknown): number[] | null {
  try {
    if (!Array.isArray(value) || !value.length || value.length > 8) return null;
    const result: number[] = [];
    for (let index = 0; index < value.length; index++) {
      const entry = Object.getOwnPropertyDescriptor(value, String(index));
      if (!entry || !("value" in entry)) return null;
      const number = entry.value;
      if (!Number.isSafeInteger(number) || number < -2147483648 || number > 2147483647) return null;
      result.push(number);
    }
    return result;
  } catch {
    return null;
  }
}
