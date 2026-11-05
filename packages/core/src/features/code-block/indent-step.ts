import { Fragment, Mark, Slice, type MarkType, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Step, StepMap, StepResult, type Mappable } from "@tiptap/pm/transform";

type IndentEdit = { from: number; to: number; slice: Slice };
const stepId = "semloEditorCodeIndentV1";
const registration = Symbol.for(`@semlo-editor/core/${stepId}`);
const stepBrand = Symbol.for(`@semlo-editor/core/${stepId}/brand`);

export function isCodeIndentStep(step: Step): step is CodeIndentStep {
  return Boolean((step as Step & { [stepBrand]?: boolean })[stepBrand]);
}

/** Skip URL detection only for whitespace changes inside code that forbids links. */
export function canSkipCodeIndentAutolink(transaction: Transaction, link: MarkType): boolean {
  if (!transaction.docChanged || !transaction.steps.length) return false;
  try {
    return transaction.steps.every((step, index) => {
      if (!isCodeIndentStep(step) || !Array.isArray(step.edits) || !step.edits.length) return false;
      const before = transaction.docs[index];
      return (step.edits as readonly IndentEdit[]).every(({ from, to, slice }) => {
        if (slice.openStart || slice.openEnd) return false;
        const $from = before.resolve(from);
        const $to = before.resolve(to);
        if (!$from.sameParent($to) || $from.parent.type.name !== "codeBlock" || $from.parent.type.allowsMarkType(link))
          return false;
        if (!/^[ \t]*$/.test(before.textBetween(from, to))) return false;
        let whitespace = true;
        slice.content.forEach((child) => {
          if (!child.isText || !/^[ \t]*$/.test(child.text ?? "")) whitespace = false;
        });
        return whitespace;
      });
    });
  } catch {
    return false;
  }
}

/** Apply flat text edits in one replacement while leaving every other mark intact. */
function replaceTextEdits(doc: ProseMirrorNode, edits: readonly IndentEdit[]): StepResult | null {
  if (!edits.length) return StepResult.ok(doc);
  const $first = doc.resolve(edits[0].from);
  const $last = doc.resolve(edits[edits.length - 1].to);
  if ($first.parent !== $last.parent || !$first.parent.isTextblock) return null;
  const parent = $first.parent;
  const start = $first.start();
  const end = $first.end();
  if (edits.some((edit) => edit.from < start || edit.to > end || edit.slice.openStart || edit.slice.openEnd))
    return null;

  const segments: Array<{ from: number; to: number; text: string; marks: readonly Mark[] }> = [];
  let flat = true;
  parent.forEach((child, offset) => {
    if (!child.isText || !child.text) flat = false;
    else segments.push({ from: offset, to: offset + child.nodeSize, text: child.text, marks: child.marks });
  });
  for (const edit of edits) edit.slice.content.forEach((child) => (flat &&= child.isText));
  if (!flat) return null;

  const runs: Array<{ marks: readonly Mark[]; parts: string[] }> = [];
  let segmentIndex = 0;
  let cursor = 0;
  const append = (text: string | undefined, marks: readonly Mark[]) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && Mark.sameSet(last.marks, marks)) last.parts.push(text);
    else runs.push({ marks, parts: [text] });
  };
  const appendOriginal = (to: number) => {
    while (cursor < to) {
      const segment = segments[segmentIndex];
      if (!segment || cursor < segment.from) throw new RangeError("Invalid code indentation range");
      const next = Math.min(to, segment.to);
      append(segment.text.slice(cursor - segment.from, next - segment.from), segment.marks);
      cursor = next;
      if (cursor === segment.to) segmentIndex += 1;
    }
  };
  for (const edit of edits) {
    appendOriginal(edit.from - start);
    edit.slice.content.forEach((child) => append(child.text, child.marks));
    cursor = edit.to - start;
    while (segments[segmentIndex] && segments[segmentIndex].to <= cursor) segmentIndex += 1;
  }
  appendOriginal(parent.content.size);
  const result = runs.map((run) => doc.type.schema.text(run.parts.join(""), run.marks));
  return StepResult.fromReplace(doc, start, end, new Slice(Fragment.fromArray(result), 0, 0));
}

/** One atomic operation with a precise multi-range map for host plugins. */
export class CodeIndentStep extends Step {
  private readonly ranges: readonly number[];
  private readonly [stepBrand] = true;

  constructor(
    readonly edits: readonly IndentEdit[],
    private readonly cached?: { before: ProseMirrorNode; after: ProseMirrorNode },
  ) {
    super();
    const ranges: number[] = [];
    let previousEnd = -1;
    for (const edit of edits) {
      if (
        !Number.isSafeInteger(edit.from) ||
        !Number.isSafeInteger(edit.to) ||
        edit.from < 0 ||
        edit.from < previousEnd ||
        edit.to < edit.from
      )
        throw new RangeError("Invalid code indentation edits");
      previousEnd = edit.to;
      ranges.push(edit.from, edit.to - edit.from, edit.slice.size);
    }
    this.ranges = ranges;
  }

  apply(doc: ProseMirrorNode): StepResult {
    if (this.cached?.before === doc) return StepResult.ok(this.cached.after);
    try {
      const flat = replaceTextEdits(doc, this.edits);
      if (flat) return flat;
      let result = StepResult.ok(doc);
      for (let i = this.edits.length - 1; i >= 0; i -= 1) {
        const edit = this.edits[i];
        result = StepResult.fromReplace(result.doc!, edit.from, edit.to, edit.slice);
        if (result.failed) return result;
      }
      return result;
    } catch (error) {
      return StepResult.fail(error instanceof Error ? error.message : "Unable to apply indentation");
    }
  }

  getMap(): StepMap {
    return new StepMap(this.ranges);
  }

  invert(doc: ProseMirrorNode): Step {
    let offset = 0;
    return new CodeIndentStep(
      this.edits.map((edit) => {
        const from = edit.from + offset;
        offset += edit.slice.size - (edit.to - edit.from);
        return { from, to: from + edit.slice.size, slice: doc.slice(edit.from, edit.to) };
      }),
    );
  }

  map(mapping: Mappable): Step | null {
    const mapped: IndentEdit[] = [];
    for (const edit of this.edits) {
      const from = mapping.mapResult(edit.from, 1);
      const to = mapping.mapResult(edit.to, -1);
      if (from.deletedAcross && to.deletedAcross) continue;
      const next = { from: from.pos, to: Math.max(from.pos, to.pos), slice: edit.slice };
      const previous = mapped[mapped.length - 1];
      if (previous && next.from <= previous.to) {
        if (previous.slice.openStart || previous.slice.openEnd || next.slice.openStart || next.slice.openEnd)
          return null;
        previous.to = Math.max(previous.to, next.to);
        previous.slice = new Slice(previous.slice.content.append(next.slice.content), 0, 0);
      } else mapped.push(next);
    }
    return mapped.length ? new CodeIndentStep(mapped) : null;
  }

  toJSON() {
    return {
      stepType: stepId,
      edits: this.edits.map((edit) => ({ from: edit.from, to: edit.to, slice: edit.slice.toJSON() })),
    };
  }

  static fromJSON(
    schema: Schema,
    json: { edits?: Array<{ from: number; to: number; slice: unknown }> },
  ): CodeIndentStep {
    if (!Array.isArray(json.edits)) throw new RangeError("Invalid code indentation step");
    return new CodeIndentStep(
      json.edits.map((edit) => ({ from: edit.from, to: edit.to, slice: Slice.fromJSON(schema, edit.slice) })),
    );
  }
}

const stepRegistry = Step as typeof Step & { [key: symbol]: boolean | undefined };
if (!stepRegistry[registration]) {
  Step.jsonID(stepId, CodeIndentStep);
  stepRegistry[registration] = true;
}
