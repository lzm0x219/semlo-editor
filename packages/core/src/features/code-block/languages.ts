import basic from "highlight.js/lib/languages/basic";
import clojure from "highlight.js/lib/languages/clojure";
import cmake from "highlight.js/lib/languages/cmake";
import dart from "highlight.js/lib/languages/dart";
import delphi from "highlight.js/lib/languages/delphi";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import erlang from "highlight.js/lib/languages/erlang";
import fortran from "highlight.js/lib/languages/fortran";
import fsharp from "highlight.js/lib/languages/fsharp";
import glsl from "highlight.js/lib/languages/glsl";
import groovy from "highlight.js/lib/languages/groovy";
import haskell from "highlight.js/lib/languages/haskell";
import http from "highlight.js/lib/languages/http";
import julia from "highlight.js/lib/languages/julia";
import latex from "highlight.js/lib/languages/latex";
import lisp from "highlight.js/lib/languages/lisp";
import matlab from "highlight.js/lib/languages/matlab";
import nginx from "highlight.js/lib/languages/nginx";
import ocaml from "highlight.js/lib/languages/ocaml";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import protobuf from "highlight.js/lib/languages/protobuf";
import scala from "highlight.js/lib/languages/scala";
import scheme from "highlight.js/lib/languages/scheme";
import tcl from "highlight.js/lib/languages/tcl";
import verilog from "highlight.js/lib/languages/verilog";
import x86asm from "highlight.js/lib/languages/x86asm";
import { common, createLowlight } from "lowlight";

import { abap, cypher, git, solidity, velocity } from "./extra-languages";
import { normalizeCodeLanguage } from "./language-aliases";
import { highlightCodeSyntax } from "./syntax-highlight";

// Load only the grammar definitions needed by the observed language list.
export const lowlight = createLowlight({
  ...common,
  abap,
  cypher,
  git,
  solidity,
  velocity,
  basic,
  clojure,
  cmake,
  dart,
  delphi,
  dockerfile,
  erlang,
  fortran,
  fsharp,
  glsl,
  groovy,
  haskell,
  http,
  julia,
  latex,
  lisp,
  matlab,
  nginx,
  ocaml,
  powershell,
  properties,
  protobuf,
  scala,
  scheme,
  tcl,
  verilog,
  x86asm,
});

// These related grammars provide partial highlighting, which is identified in
// the picker instead of being presented as a dedicated grammar.
lowlight.registerAlias({
  typescript: ["arkts"],
  haskell: ["agda"],
  xml: ["vue"],
  scss: ["sass"],
  sql: ["plsql"],
  verilog: ["systemverilog"],
  latex: ["katex", "stex"],
});

// Unknown imported identifiers must stay plain text, rather than being
// silently auto-detected as an unrelated language.
export const codeLowlight = {
  ...lowlight,
  registered: (language: string) => lowlight.registered(normalizeCodeLanguage(language)),
  highlight: (language: string, value: string, options?: Parameters<typeof lowlight.highlight>[2]) => {
    const normalized = normalizeCodeLanguage(language);
    if (
      normalized === "jsx" ||
      normalized === "tsx" ||
      normalized === "arkts" ||
      normalized === "velocity" ||
      normalized === "markdown" ||
      normalized === "basic" ||
      normalized === "makefile" ||
      normalized === "fsharp" ||
      normalized === "lisp" ||
      normalized === "julia" ||
      normalized === "matlab" ||
      normalized === "pascal" ||
      normalized === "powershell" ||
      normalized === "protobuf" ||
      normalized === "tcl" ||
      normalized === "vbnet" ||
      normalized === "properties" ||
      normalized === "diff" ||
      normalized === "cmake" ||
      normalized === "erlang" ||
      normalized === "fortran" ||
      normalized === "scheme" ||
      normalized === "clojure" ||
      normalized === "ocaml" ||
      normalized === "dockerfile" ||
      normalized === "nginx" ||
      normalized === "http" ||
      normalized === "r" ||
      normalized === "perl" ||
      normalized === "lua" ||
      normalized === "haskell" ||
      normalized === "objectivec" ||
      normalized === "groovy" ||
      normalized === "glsl" ||
      normalized === "dart" ||
      normalized === "kotlin" ||
      normalized === "scala" ||
      normalized === "sql" ||
      normalized === "swift" ||
      normalized === "ruby" ||
      normalized === "c" ||
      normalized === "csharp" ||
      normalized === "toml" ||
      normalized === "yaml" ||
      normalized === "go" ||
      normalized === "php" ||
      normalized === "cpp" ||
      normalized === "java" ||
      normalized === "xml" ||
      normalized === "html" ||
      normalized === "vue" ||
      normalized === "less" ||
      normalized === "css" ||
      normalized === "python" ||
      normalized === "rust" ||
      normalized === "json" ||
      normalized === "typescript" ||
      normalized === "javascript" ||
      normalized === "latex" ||
      normalized === "systemverilog" ||
      normalized === "plsql" ||
      normalized === "git" ||
      normalized === "katex" ||
      normalized === "stex" ||
      normalized === "sass" ||
      normalized === "cypher" ||
      normalized === "shell" ||
      normalized === "bash"
    ) {
      const highlighted = highlightCodeSyntax(value, normalized);
      if (highlighted) return highlighted;
    }
    return lowlight.highlight(lowlight.registered(normalized) ? normalized : "plaintext", value, options);
  },
  highlightAuto: (value: string) => lowlight.highlight("plaintext", value),
};
