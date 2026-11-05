import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { less } from "@codemirror/lang-less";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass } from "@codemirror/lang-sass";
import { PLSQL, sql } from "@codemirror/lang-sql";
import { vue } from "@codemirror/lang-vue";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { csharp, dart, kotlin, objectiveC, scala, shader } from "@codemirror/legacy-modes/mode/clike";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { commonLisp } from "@codemirror/legacy-modes/mode/commonlisp";
import { cypher } from "@codemirror/legacy-modes/mode/cypher";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { fortran } from "@codemirror/legacy-modes/mode/fortran";
import { gas } from "@codemirror/legacy-modes/mode/gas";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { http } from "@codemirror/legacy-modes/mode/http";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { fSharp, oCaml } from "@codemirror/legacy-modes/mode/mllike";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { octave } from "@codemirror/legacy-modes/mode/octave";
import { pascal } from "@codemirror/legacy-modes/mode/pascal";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { r } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { scheme } from "@codemirror/legacy-modes/mode/scheme";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { tcl } from "@codemirror/legacy-modes/mode/tcl";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { velocity } from "@codemirror/legacy-modes/mode/velocity";
import { verilog } from "@codemirror/legacy-modes/mode/verilog";
import type { Extension } from "@codemirror/state";

import { normalizeCodeLanguage } from "./language-aliases";

// Resolve parsers synchronously: typing must never wait for a language download
// or apply a delayed indentation to a document the user has since changed.
const factories: Record<string, () => Extension> = {
  // Related parsers supply approximate indentation for languages without a
  // dedicated mode. They do not change the language stored in the document.
  arkts: () => javascript({ typescript: true }),
  bash: () => StreamLanguage.define(shell),
  c: cpp,
  clojure: () => StreamLanguage.define(clojure),
  cmake: () => StreamLanguage.define(cmake),
  cpp,
  csharp: () => StreamLanguage.define(csharp),
  css,
  cypher: () => StreamLanguage.define(cypher),
  dart: () => StreamLanguage.define(dart),
  diff: () => StreamLanguage.define(diff),
  dockerfile: () => StreamLanguage.define(dockerFile),
  erlang: () => StreamLanguage.define(erlang),
  fortran: () => StreamLanguage.define(fortran),
  fsharp: () => StreamLanguage.define(fSharp),
  glsl: () => StreamLanguage.define(shader),
  go,
  groovy: () => StreamLanguage.define(groovy),
  haskell: () => StreamLanguage.define(haskell),
  html,
  http: () => StreamLanguage.define(http),
  java,
  javascript,
  json,
  jsx: () => javascript({ jsx: true }),
  julia: () => StreamLanguage.define(julia),
  katex: () => StreamLanguage.define(stex),
  kotlin: () => StreamLanguage.define(kotlin),
  latex: () => StreamLanguage.define(stex),
  less,
  lisp: () => StreamLanguage.define(commonLisp),
  lua: () => StreamLanguage.define(lua),
  markdown,
  matlab: () => StreamLanguage.define(octave),
  nginx: () => StreamLanguage.define(nginx),
  objectivec: () => StreamLanguage.define(objectiveC),
  ocaml: () => StreamLanguage.define(oCaml),
  pascal: () => StreamLanguage.define(pascal),
  perl: () => StreamLanguage.define(perl),
  php,
  plsql: () => sql({ dialect: PLSQL }),
  powershell: () => StreamLanguage.define(powerShell),
  properties: () => StreamLanguage.define(properties),
  protobuf: () => StreamLanguage.define(protobuf),
  python,
  r: () => StreamLanguage.define(r),
  ruby: () => StreamLanguage.define(ruby),
  rust,
  sass: () => sass({ indented: true }),
  scala: () => StreamLanguage.define(scala),
  scheme: () => StreamLanguage.define(scheme),
  shell: () => StreamLanguage.define(shell),
  solidity: cpp,
  sql,
  stex: () => StreamLanguage.define(stex),
  swift: () => StreamLanguage.define(swift),
  systemverilog: () => StreamLanguage.define(verilog),
  tcl: () => StreamLanguage.define(tcl),
  toml: () => StreamLanguage.define(toml),
  tsx: () => javascript({ jsx: true, typescript: true }),
  typescript: () => javascript({ typescript: true }),
  vbnet: () => StreamLanguage.define(vb),
  velocity: () => StreamLanguage.define(velocity),
  verilog: () => StreamLanguage.define(verilog),
  vue,
  x86asm: () => StreamLanguage.define(gas),
  xml,
  yaml,
};

const cached = new Map<string, Extension>();

/** Whether the selected language has indentation rules. */
export function hasCodeIndentLanguage(language: string): boolean {
  return Object.hasOwn(factories, normalizeCodeLanguage(language));
}

/** Return an indentation parser, or CodeMirror's plain-text behavior if none is available. */
export function codeIndentLanguage(language: string | null): Extension {
  if (typeof language !== "string") return [];
  const name = normalizeCodeLanguage(language);
  if (!Object.hasOwn(factories, name)) return [];
  let result = cached.get(name);
  if (!result) {
    result = factories[name]();
    cached.set(name, result);
  }
  return result;
}
