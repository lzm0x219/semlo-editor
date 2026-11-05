import { phpLanguage } from "@codemirror/lang-php";
import { indentNodeProp, LRLanguage } from "@codemirror/language";
import { parser } from "@lezer/php-legacy";

// Yuque's CodeMirror 7.1.26 uses the 1.0.2 PHP grammar.
// Retain CodeMirror's indentation rules on the matching older grammar.
const indentation = Object.fromEntries(
  phpLanguage.parser.nodeSet.types.flatMap((type) => {
    const rule = type.prop(indentNodeProp);
    return rule ? [[type.name, rule]] : [];
  }),
);

export const legacyPHPIndentation = LRLanguage.define({
  name: "php",
  parser: parser.configure({ top: "Program", props: [indentNodeProp.add(indentation)] }),
});
