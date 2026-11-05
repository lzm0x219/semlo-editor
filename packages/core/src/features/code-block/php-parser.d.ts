// @lezer/php 1.0.2 ships declarations but does not expose them via exports.
declare module "@lezer/php-legacy" {
  export const parser: typeof import("@codemirror/lang-php").phpLanguage.parser;
}
