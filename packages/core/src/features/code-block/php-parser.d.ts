// @lezer/php 1.0.3 包含声明文件，但未通过 exports 导出。
declare module "@lezer/php-legacy" {
  export const parser: typeof import("@codemirror/lang-php").phpLanguage.parser;
}
