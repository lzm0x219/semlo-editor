import { phpLanguage } from "@codemirror/lang-php";
import { indentNodeProp, LRLanguage } from "@codemirror/language";
import { parser } from "@lezer/php-legacy";

// 语雀 CodeMirror 7.1.26 的已观察行为依赖 1.0.2 语法，专用别名必须保持该版本。
// 带 PHP 标签时的错误恢复也会影响缩进；借用当前 CodeMirror 规则，不替换旧解析器。
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
