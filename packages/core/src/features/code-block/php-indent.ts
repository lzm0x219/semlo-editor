import { phpLanguage } from "@codemirror/lang-php";
import { indentNodeProp, LRLanguage } from "@codemirror/language";
import { parser } from "@lezer/php-legacy";

// 专用别名保持已验证的 1.0.3 语法，1.0.4 起会改变带标签源码的解析行为。
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
