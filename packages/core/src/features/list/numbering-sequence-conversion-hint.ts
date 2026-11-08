/** 转换后的列表项保留原续接边和所属序列，供显式转回时核验。 */
export const sequenceConversionHintAttribute = "semloEditorListSequenceConversion";
export const sequenceConversionHintHTMLAttribute = "data-semlo-editor-list-sequence-conversion";

export interface SequenceConversionHint {
  edge: string;
  sequenceId: string;
}

export function formatSequenceConversionHint(edge: string, sequenceId: string): string {
  return JSON.stringify([1, edge, sequenceId]);
}

export function parseSequenceConversionHint(value: unknown): SequenceConversionHint | null {
  if (typeof value !== "string" || value.length > 1024) return null;
  try {
    const decoded: unknown = JSON.parse(value);
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 3 ||
      decoded[0] !== 1 ||
      typeof decoded[1] !== "string" ||
      !/^[A-Za-z0-9-]{1,64}$/.test(decoded[1]) ||
      typeof decoded[2] !== "string" ||
      decoded[2].length === 0 ||
      decoded[2].length > 64
    )
      return null;
    return { edge: decoded[1], sequenceId: decoded[2] };
  } catch {
    return null;
  }
}
