import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass } from "@codemirror/lang-sass";
import { vue } from "@codemirror/lang-vue";
import { xml } from "@codemirror/lang-xml";
import { ensureSyntaxTree, LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { c, csharp, dart, kotlin, scala, objectiveC, shader } from "@codemirror/legacy-modes/mode/clike";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { commonLisp } from "@codemirror/legacy-modes/mode/commonlisp";
import { cypher } from "@codemirror/legacy-modes/mode/cypher";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { fortran } from "@codemirror/legacy-modes/mode/fortran";
import { go } from "@codemirror/legacy-modes/mode/go";
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
import { plSQL, sql } from "@codemirror/legacy-modes/mode/sql";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { tcl } from "@codemirror/legacy-modes/mode/tcl";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { vbScript } from "@codemirror/legacy-modes/mode/vbscript";
import { velocity } from "@codemirror/legacy-modes/mode/velocity";
import { verilog } from "@codemirror/legacy-modes/mode/verilog";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { EditorState, type Extension } from "@codemirror/state";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { parser as legacyPhpParser } from "@lezer/php-legacy";

const swiftLanguage = StreamLanguage.define(swift);
const rubyLanguage = StreamLanguage.define(ruby);
const fsharpLanguage = StreamLanguage.define(fSharp);
const lispLanguage = StreamLanguage.define(commonLisp);
const juliaLanguage = StreamLanguage.define(julia);
const matlabLanguage = StreamLanguage.define(octave);
const pascalLanguage = StreamLanguage.define(pascal);
const powershellLanguage = StreamLanguage.define(powerShell);
const protobufLanguage = StreamLanguage.define(protobuf);
const tclLanguage = StreamLanguage.define(tcl);
const vbnetLanguage = StreamLanguage.define(vb);
const basicLanguage = StreamLanguage.define(vbScript);
const makefileLanguage = StreamLanguage.define({
  startState: () => ({ header: "" as "" | "target" | "assignment" }),
  token(stream, state) {
    if (stream.sol()) {
      const header = /^\s*[\w.-]+\s*([:=])/.exec(stream.string);
      state.header = header ? (header[1] === ":" ? "target" : "assignment") : "";
    }
    if (stream.eatSpace()) return null;
    if (state.header) {
      const kind = state.header;
      state.header = "";
      if (stream.match(/^[\w.-]+/)) {
        if (kind === "assignment") return "variableName.special";
        return /^\.(?:PHONY|SUFFIXES|DEFAULT|PRECIOUS|INTERMEDIATE|SECONDARY|SECONDEXPANSION|DELETE_ON_ERROR|IGNORE|LOW_RESOLUTION_TIME|SILENT|EXPORT_ALL_VARIABLES|NOTPARALLEL|ONESHELL|POSIX)$/.test(
          stream.current(),
        )
          ? "keyword"
          : "variableName.definition";
      }
    }
    if (stream.match(/^\\./)) return null;
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^\$\([^)]*\)/)) return "variableName.special";
    if (stream.eat(":")) return "operator";
    stream.next();
    return null;
  },
});
const propertiesLanguage = StreamLanguage.define(properties);
const diffLanguage = StreamLanguage.define(diff);
const cmakeLanguage = StreamLanguage.define(cmake);
const erlangLanguage = StreamLanguage.define(erlang);
const fortranLanguage = StreamLanguage.define(fortran);
const schemeLanguage = StreamLanguage.define(scheme);
const clojureLanguage = StreamLanguage.define(clojure);
const ocamlLanguage = StreamLanguage.define(oCaml);
const dockerfileLanguage = StreamLanguage.define(dockerFile);
const nginxLanguage = StreamLanguage.define(nginx);
const httpLanguage = StreamLanguage.define(http);
const rLanguage = StreamLanguage.define(r);
const perlLanguage = StreamLanguage.define(perl);
const luaLanguage = StreamLanguage.define(lua);
const haskellLanguage = StreamLanguage.define(haskell);
const objectivecLanguage = StreamLanguage.define(objectiveC);
const groovyLanguage = StreamLanguage.define(groovy);
const glslLanguage = StreamLanguage.define(shader);
const dartLanguage = StreamLanguage.define(dart);
const kotlinLanguage = StreamLanguage.define(kotlin);
const scalaLanguage = StreamLanguage.define(scala);
const cLanguage = StreamLanguage.define(c);
const csharpLanguage = StreamLanguage.define(csharp);
const tomlLanguage = StreamLanguage.define(toml);
const yamlLanguage = StreamLanguage.define(yaml);
const goLanguage = StreamLanguage.define(go);
const velocityLanguage = StreamLanguage.define(velocity);
const cypherLanguage = StreamLanguage.define(cypher);
const systemverilogLanguage = StreamLanguage.define(verilog);
const sqlLanguage = StreamLanguage.define(
  sql({ support: { commentSlashSlash: true, commentHash: true, commentSpaceRequired: true } }),
);
const plsqlLanguage = StreamLanguage.define(plSQL);
const stexLanguage = StreamLanguage.define(stex);
const shellLanguage = StreamLanguage.define(shell);
// 与自动缩进共用固定的 1.0.2 语法，保留带 PHP 标签时已观察到的解析与高亮。
const phpParser = legacyPhpParser.configure({ top: "Program" });
const cppSupport = cpp();
const javaSupport = java();
const cppParser = cppSupport.language.parser;
const javaParser = javaSupport.language.parser;
const xmlSupport = xml();
const xmlParser = xmlSupport.language.parser;
const vueParser = vue().language.parser;
const htmlSupport = html();
const htmlParser = htmlSupport.language.parser;
const cssSupport = css();
const cssParser = cssSupport.language.parser;
const pythonSupport = python();
const pythonParser = pythonSupport.language.parser;
const rustSupport = rust();
const rustParser = rustSupport.language.parser;
const jsonSupport = json();
const jsonParser = jsonSupport.language.parser;
const sassParser = sass().language.parser;
const javascriptSupport = javascript();
const typescriptSupport = javascript({ typescript: true });
const javascriptParser = javascriptSupport.language.parser;
const markdownParser = markdown({
  addKeymap: false,
  codeLanguages: [
    LanguageDescription.of({ name: "javascript", alias: ["js"], support: javascriptSupport }),
    LanguageDescription.of({ name: "typescript", alias: ["ts"], support: typescriptSupport }),
    LanguageDescription.of({ name: "python", alias: ["py"], support: pythonSupport }),
    LanguageDescription.of({ name: "json", support: jsonSupport }),
    LanguageDescription.of({ name: "rust", alias: ["rs"], support: rustSupport }),
    LanguageDescription.of({ name: "html", alias: ["htm"], support: htmlSupport }),
    LanguageDescription.of({ name: "css", support: cssSupport }),
    LanguageDescription.of({ name: "shell", alias: ["bash", "sh"], support: new LanguageSupport(shellLanguage) }),
    LanguageDescription.of({ name: "sql", support: new LanguageSupport(sqlLanguage) }),
    LanguageDescription.of({ name: "go", support: new LanguageSupport(goLanguage) }),
    LanguageDescription.of({ name: "julia", alias: ["jl"], support: new LanguageSupport(juliaLanguage) }),
    LanguageDescription.of({ name: "haskell", alias: ["hs"], support: new LanguageSupport(haskellLanguage) }),
    LanguageDescription.of({ name: "lua", support: new LanguageSupport(luaLanguage) }),
    LanguageDescription.of({
      name: "powershell",
      alias: ["ps1", "psd1", "psm1"],
      support: new LanguageSupport(powershellLanguage),
    }),
    LanguageDescription.of({ name: "dockerfile", support: new LanguageSupport(dockerfileLanguage) }),
    LanguageDescription.of({ name: "scala", support: new LanguageSupport(scalaLanguage) }),
    LanguageDescription.of({ name: "dart", support: new LanguageSupport(dartLanguage) }),
    LanguageDescription.of({ name: "objectivec", alias: ["m"], support: new LanguageSupport(objectivecLanguage) }),
    LanguageDescription.of({ name: "groovy", alias: ["gradle"], support: new LanguageSupport(groovyLanguage) }),
    LanguageDescription.of({ name: "r", support: new LanguageSupport(rLanguage) }),
    LanguageDescription.of({ name: "perl", alias: ["pl", "pm"], support: new LanguageSupport(perlLanguage) }),
    LanguageDescription.of({ name: "xml", alias: ["xsl", "xsd", "svg"], support: xmlSupport }),
    LanguageDescription.of({ name: "ruby", alias: ["rb"], support: new LanguageSupport(rubyLanguage) }),
    LanguageDescription.of({ name: "yaml", alias: ["yml"], support: new LanguageSupport(yamlLanguage) }),
    LanguageDescription.of({ name: "toml", support: new LanguageSupport(tomlLanguage) }),
    LanguageDescription.of({ name: "swift", support: new LanguageSupport(swiftLanguage) }),
    LanguageDescription.of({ name: "kotlin", alias: ["kt"], support: new LanguageSupport(kotlinLanguage) }),
    LanguageDescription.of({ name: "java", support: javaSupport }),
    LanguageDescription.of({ name: "c", alias: ["h", "ino"], support: new LanguageSupport(cLanguage) }),
    LanguageDescription.of({
      name: "cpp",
      alias: ["c++", "cc", "cxx", "hpp", "h++", "hh", "hxx"],
      support: cppSupport,
    }),
    LanguageDescription.of({ name: "c#", alias: ["cs"], support: new LanguageSupport(csharpLanguage) }),
  ],
}).language.parser;
const parser = javascript({ jsx: true }).language.parser;
const arktsParser = typescriptSupport.language.parser;
const typescriptParser = javascript({ jsx: true, typescript: true }).language.parser;
const styles = [
  { tag: [tags.keyword, tags.null], class: "semlo-editor-syntax-keyword" },
  { tag: tags.bool, class: "semlo-editor-syntax-bool" },
  { tag: tags.regexp, class: "semlo-editor-syntax-regex" },
  { tag: tags.operator, class: "semlo-editor-syntax-operator" },
  { tag: tags.variableName, class: "semlo-editor-syntax-variable" },
  { tag: tags.definition(tags.variableName), class: "semlo-editor-syntax-definition" },
  { tag: tags.tagName, class: "semlo-editor-syntax-tag" },
  { tag: tags.attributeName, class: "semlo-editor-syntax-attribute" },
  { tag: tags.string, class: "semlo-editor-syntax-string" },
  { tag: tags.number, class: "semlo-editor-syntax-number" },
  { tag: tags.comment, class: "semlo-editor-syntax-comment" },
  { tag: tags.propertyName, class: "semlo-editor-syntax-property" },
  { tag: tags.typeName, class: "semlo-editor-syntax-type" },
];
const highlighter = tagHighlighter(styles);
const phpHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.className, class: "semlo-editor-syntax-definition" },
  { tag: tags.modifier, class: "semlo-editor-syntax-keyword" },
  { tag: [tags.punctuation, tags.namespace], class: "semlo-editor-syntax-punctuation" },
]);
const cppHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.modifier, class: "semlo-editor-syntax-keyword" },
  { tag: [tags.punctuation, tags.namespace], class: "semlo-editor-syntax-punctuation" },
  { tag: tags.processingInstruction, class: "semlo-editor-syntax-meta" },
  { tag: tags.special(tags.string), class: "semlo-editor-syntax-special-string" },
]);
const javaHighlighter = tagHighlighter([
  ...styles,
  { tag: [tags.modifier, tags.self], class: "semlo-editor-syntax-keyword" },
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
]);
const xmlHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
  { tag: tags.processingInstruction, class: "semlo-editor-syntax-meta" },
  { tag: [tags.attributeValue, tags.character], class: "semlo-editor-syntax-string" },
]);
const htmlHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.className, class: "semlo-editor-syntax-definition" },
  { tag: tags.atom, class: "semlo-editor-syntax-atom" },
  { tag: [tags.color, tags.punctuation], class: "semlo-editor-syntax-punctuation" },
  { tag: tags.unit, class: "semlo-editor-syntax-keyword" },
  { tag: tags.documentMeta, class: "semlo-editor-syntax-meta" },
  { tag: tags.attributeValue, class: "semlo-editor-syntax-string" },
]);
const cssHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.className, class: "semlo-editor-syntax-definition" },
  { tag: tags.atom, class: "semlo-editor-syntax-atom" },
  { tag: [tags.color, tags.punctuation], class: "semlo-editor-syntax-punctuation" },
  { tag: tags.unit, class: "semlo-editor-syntax-keyword" },
]);
const pythonHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.className, class: "semlo-editor-syntax-definition" },
  { tag: tags.special(tags.string), class: "semlo-editor-syntax-special-string" },
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
]);
const rustHighlighter = tagHighlighter([
  ...styles,
  { tag: [tags.punctuation, tags.macroName, tags.namespace], class: "semlo-editor-syntax-punctuation" },
]);
const javascriptHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
]);
const streamHighlighter = tagHighlighter([...styles, { tag: tags.meta, class: "semlo-editor-syntax-meta" }]);
const httpHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.atom, class: "semlo-editor-syntax-atom" },
  { tag: tags.special(tags.string), class: "semlo-editor-syntax-special-string" },
]);
const yamlHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.atom, class: "semlo-editor-syntax-atom" },
  { tag: tags.meta, class: "semlo-editor-syntax-meta" },
]);
const markdownXmlHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.tagName, class: "semlo-editor-syntax-type" },
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
  { tag: tags.processingInstruction, class: "semlo-editor-syntax-meta" },
  { tag: [tags.attributeValue, tags.character], class: "semlo-editor-syntax-string" },
]);
const markdownRubyHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.tagName, class: "semlo-editor-syntax-type" },
  { tag: tags.atom, class: "semlo-editor-syntax-atom" },
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
]);
const markdownHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
  { tag: tags.heading, class: "semlo-editor-syntax-markdown-heading" },
  { tag: tags.meta, class: "semlo-editor-syntax-meta" },
]);
const markdownInterpolatedHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
  { tag: tags.special(tags.string), class: "semlo-editor-syntax-special-string" },
]);
const propertiesHighlighter = tagHighlighter([
  { tag: tags.comment, class: "semlo-editor-syntax-comment" },
  { tag: tags.heading, class: "semlo-editor-syntax-properties-header" },
  { tag: tags.variableName, class: "semlo-editor-syntax-definition" },
]);
const diffHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.deleted, class: "semlo-editor-syntax-diff-deleted" },
  { tag: tags.inserted, class: "semlo-editor-syntax-diff-inserted" },
  { tag: tags.meta, class: "semlo-editor-syntax-meta" },
]);
const cmakeHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.variableName, class: "semlo-editor-syntax-definition" },
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
]);
const cypherHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.atom, class: "semlo-editor-syntax-atom" },
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
]);
const makefileHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.special(tags.variableName), class: "semlo-editor-syntax-make-variable" },
]);
const systemverilogHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.meta, class: "semlo-editor-syntax-meta" },
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
]);
const plsqlHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
]);
const stexHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.variableName, class: "semlo-editor-syntax-stex-variable" },
  { tag: tags.atom, class: "semlo-editor-syntax-atom" },
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
]);
const sassHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.variableName, class: "semlo-editor-syntax-sass-variable" },
  { tag: tags.className, class: "semlo-editor-syntax-definition" },
  { tag: tags.atom, class: "semlo-editor-syntax-atom" },
  { tag: tags.color, class: "semlo-editor-syntax-punctuation" },
  { tag: tags.punctuation, class: "semlo-editor-syntax-punctuation" },
]);
const shellHighlighter = tagHighlighter([
  ...styles,
  { tag: tags.meta, class: "semlo-editor-syntax-meta" },
  { tag: tags.standard(tags.variableName), class: "semlo-editor-syntax-builtin" },
  { tag: tags.special(tags.string), class: "semlo-editor-syntax-special-string" },
]);

const legacyClasses: Record<string, string> = {
  "semlo-editor-syntax-markdown-heading": "hljs-section",
  "semlo-editor-syntax-make-variable": "hljs-variable",
  "semlo-editor-syntax-keyword": "hljs-keyword",
  "semlo-editor-syntax-stex-variable": "hljs-variable",
  "semlo-editor-syntax-sass-variable": "hljs-variable",
  "semlo-editor-syntax-atom": "hljs-symbol",
  "semlo-editor-syntax-builtin": "hljs-built_in",
  "semlo-editor-syntax-meta": "hljs-meta",
  "semlo-editor-syntax-special-string": "hljs-string",
  "semlo-editor-syntax-bool": "hljs-literal",
  "semlo-editor-syntax-definition": "hljs-title",
  "semlo-editor-syntax-variable": "hljs-variable",
  "semlo-editor-syntax-tag": "hljs-name",
  "semlo-editor-syntax-attribute": "hljs-attr",
  "semlo-editor-syntax-string": "hljs-string",
  "semlo-editor-syntax-regex": "hljs-regexp",
  "semlo-editor-syntax-number": "hljs-number",
  "semlo-editor-syntax-comment": "hljs-comment",
  "semlo-editor-syntax-property": "hljs-property",
  "semlo-editor-syntax-type": "hljs-type",
};

type TextNode = { type: "text"; value: string };
type TokenNode = { type: "element"; tagName: "span"; properties: { className: string[] }; children: TextNode[] };

type SyntaxLanguage =
  | "vue"
  | "jsx"
  | "tsx"
  | "arkts"
  | "velocity"
  | "shell"
  | "bash"
  | "cypher"
  | "sass"
  | "stex"
  | "git"
  | "katex"
  | "plsql"
  | "systemverilog"
  | "latex"
  | "javascript"
  | "typescript"
  | "json"
  | "rust"
  | "python"
  | "css"
  | "less"
  | "html"
  | "xml"
  | "java"
  | "cpp"
  | "php"
  | "go"
  | "yaml"
  | "toml"
  | "c"
  | "csharp"
  | "swift"
  | "ruby"
  | "sql"
  | "dart"
  | "kotlin"
  | "scala"
  | "objectivec"
  | "groovy"
  | "glsl"
  | "r"
  | "perl"
  | "lua"
  | "haskell"
  | "dockerfile"
  | "nginx"
  | "http"
  | "scheme"
  | "clojure"
  | "ocaml"
  | "markdown"
  | "basic"
  | "makefile"
  | "fsharp"
  | "lisp"
  | "julia"
  | "matlab"
  | "pascal"
  | "powershell"
  | "protobuf"
  | "tcl"
  | "vbnet"
  | "properties"
  | "diff"
  | "cmake"
  | "erlang"
  | "fortran";

type SyntaxConfig = {
  parser?: typeof parser;
  stream?: Extension;
  highlighter: ReturnType<typeof tagHighlighter>;
  maxChars?: number;
  maxTokens?: number;
};

// These are immutable parser definitions; each stream parse owns its EditorState.
const syntaxConfigs: Record<SyntaxLanguage, SyntaxConfig> = {
  vue: { parser: htmlParser, highlighter: htmlHighlighter, maxChars: 6000, maxTokens: 3000 },
  jsx: { parser, highlighter },
  tsx: { parser: typescriptParser, highlighter },
  arkts: { parser: arktsParser, highlighter },
  javascript: { parser: javascriptParser, highlighter: javascriptHighlighter, maxChars: 12000 },
  typescript: { parser: arktsParser, highlighter: javascriptHighlighter, maxChars: 12000 },
  json: { parser: jsonParser, highlighter: javascriptHighlighter, maxChars: 12000 },
  rust: { parser: rustParser, highlighter: rustHighlighter, maxChars: 12000 },
  python: { parser: pythonParser, highlighter: pythonHighlighter, maxChars: 12000 },
  html: { parser: htmlParser, highlighter: htmlHighlighter, maxChars: 12000 },
  xml: { parser: xmlParser, highlighter: xmlHighlighter, maxChars: 12000 },
  java: { parser: javaParser, highlighter: javaHighlighter, maxChars: 12000 },
  cpp: { parser: cppParser, highlighter: cppHighlighter, maxChars: 12000 },
  php: { parser: phpParser, highlighter: phpHighlighter, maxChars: 12000 },
  css: { parser: cssParser, highlighter: cssHighlighter, maxChars: 12000 },
  less: { parser: cssParser, highlighter: cssHighlighter, maxChars: 12000 },
  sass: { parser: sassParser, highlighter: sassHighlighter, maxChars: 12000, maxTokens: 3000 },
  swift: { stream: swiftLanguage, highlighter: cypherHighlighter, maxChars: 12000, maxTokens: 3000 },
  ruby: { stream: rubyLanguage, highlighter: cypherHighlighter, maxChars: 12000, maxTokens: 3000 },
  markdown: { parser: markdownParser, highlighter: markdownHighlighter, maxChars: 12000, maxTokens: 3000 },
  basic: { stream: basicLanguage, highlighter: cypherHighlighter, maxChars: 12000, maxTokens: 3000 },
  makefile: { stream: makefileLanguage, highlighter: makefileHighlighter, maxChars: 12000, maxTokens: 3000 },
  fsharp: { stream: fsharpLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  lisp: { stream: lispLanguage, highlighter: cypherHighlighter, maxChars: 12000, maxTokens: 3000 },
  julia: { stream: juliaLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  matlab: { stream: matlabLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  pascal: { stream: pascalLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  powershell: { stream: powershellLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  protobuf: { stream: protobufLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  tcl: { stream: tclLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  vbnet: { stream: vbnetLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  properties: { stream: propertiesLanguage, highlighter: propertiesHighlighter, maxChars: 12000, maxTokens: 3000 },
  diff: { stream: diffLanguage, highlighter: diffHighlighter, maxChars: 12000, maxTokens: 3000 },
  cmake: { stream: cmakeLanguage, highlighter: cmakeHighlighter, maxChars: 12000, maxTokens: 3000 },
  erlang: { stream: erlangLanguage, highlighter: yamlHighlighter, maxChars: 12000, maxTokens: 3000 },
  fortran: { stream: fortranLanguage, highlighter: yamlHighlighter, maxChars: 12000, maxTokens: 3000 },
  scheme: { stream: schemeLanguage, highlighter: cypherHighlighter, maxChars: 12000, maxTokens: 3000 },
  clojure: { stream: clojureLanguage, highlighter: cypherHighlighter, maxChars: 12000, maxTokens: 3000 },
  ocaml: { stream: ocamlLanguage, highlighter: cypherHighlighter, maxChars: 12000, maxTokens: 3000 },
  dockerfile: { stream: dockerfileLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  nginx: { stream: nginxLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  http: { stream: httpLanguage, highlighter: httpHighlighter, maxChars: 12000, maxTokens: 3000 },
  r: { stream: rLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  perl: { stream: perlLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  lua: { stream: luaLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  haskell: { stream: haskellLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  objectivec: { stream: objectivecLanguage, highlighter: yamlHighlighter, maxChars: 12000, maxTokens: 3000 },
  groovy: { stream: groovyLanguage, highlighter: yamlHighlighter, maxChars: 12000, maxTokens: 3000 },
  glsl: { stream: glslLanguage, highlighter: yamlHighlighter, maxChars: 12000, maxTokens: 3000 },
  dart: { stream: dartLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  kotlin: { stream: kotlinLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  scala: { stream: scalaLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  c: { stream: cLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  csharp: { stream: csharpLanguage, highlighter: streamHighlighter, maxChars: 12000, maxTokens: 3000 },
  toml: { stream: tomlLanguage, highlighter: cypherHighlighter, maxChars: 12000, maxTokens: 3000 },
  yaml: { stream: yamlLanguage, highlighter: yamlHighlighter, maxChars: 12000, maxTokens: 3000 },
  go: { stream: goLanguage, highlighter, maxChars: 12000, maxTokens: 3000 },
  velocity: { stream: velocityLanguage, highlighter: streamHighlighter },
  shell: { stream: shellLanguage, highlighter: shellHighlighter, maxTokens: 3000 },
  bash: { stream: shellLanguage, highlighter: shellHighlighter, maxTokens: 3000 },
  git: { stream: shellLanguage, highlighter: shellHighlighter, maxTokens: 3000 },
  cypher: { stream: cypherLanguage, highlighter: cypherHighlighter, maxTokens: 3000 },
  stex: { stream: stexLanguage, highlighter: stexHighlighter, maxTokens: 3000 },
  katex: { stream: stexLanguage, highlighter: stexHighlighter, maxTokens: 3000 },
  latex: { stream: stexLanguage, highlighter: stexHighlighter, maxTokens: 3000 },
  sql: { stream: sqlLanguage, highlighter: cypherHighlighter, maxChars: 12000, maxTokens: 3000 },
  plsql: { stream: plsqlLanguage, highlighter: plsqlHighlighter, maxTokens: 3000 },
  systemverilog: {
    stream: systemverilogLanguage,
    highlighter: systemverilogHighlighter,
    maxChars: 12000,
    maxTokens: 3000,
  },
};

export function highlightCodeSyntax(value: string, language: SyntaxLanguage) {
  const children: Array<TextNode | TokenNode> = [];
  let position = 0;
  let tokenCount = 0;
  let tooManyTokens = false;
  const config = syntaxConfigs[language];
  // Parsing large documents can exceed the editing frame budget.
  if (config.maxChars !== undefined && value.length > config.maxChars) return null;
  // Preserve fallback for Vue dynamic directive arguments outside the observed grammar.
  if (language === "vue" && /(?:[:@#]|\bv-(?:bind|on|slot):)\[/.test(value)) return null;
  // Continue using the existing fallback for constructs outside the observed line grammar.
  if (
    language === "makefile" &&
    (/\\\r?\n/.test(value) || /\$\([^\n)]*\$\(/.test(value) || /^\s*(?:define|endef)\b/m.test(value))
  )
    return null;
  const tree = config.stream
    ? ensureSyntaxTree(EditorState.create({ doc: value, extensions: [config.stream] }), value.length, 10)
    : config.parser?.parse(value);
  if (!tree) return null;
  let hasCssFence = false;
  let hasShellFence = false;
  let hasSqlFence = false;
  let hasYamlFence = false;
  let hasTomlFence = false;
  let hasXmlFence = false;
  let hasRubyFence = false;
  let hasInterpolatedFence = false;
  if (language === "markdown") {
    // Preserve the existing fallback for languages without an embedded parser.
    const cursor = tree.cursor();
    do {
      if (cursor.name === "FencedCode") {
        const info = cursor.node.getChild("CodeInfo");
        const languageName = info && value.slice(info.from, info.to).trim().split(/\s+/, 1)[0].toLowerCase();
        if (
          !languageName ||
          ![
            "js",
            "javascript",
            "ts",
            "typescript",
            "py",
            "python",
            "json",
            "rs",
            "rust",
            "htm",
            "html",
            "css",
            "shell",
            "bash",
            "sh",
            "sql",
            "go",
            "julia",
            "jl",
            "haskell",
            "hs",
            "lua",
            "powershell",
            "ps1",
            "psd1",
            "psm1",
            "dockerfile",
            "scala",
            "dart",
            "objectivec",
            "m",
            "groovy",
            "gradle",
            "r",
            "perl",
            "pl",
            "pm",
            "xml",
            "xsl",
            "xsd",
            "svg",
            "ruby",
            "rb",
            "yaml",
            "yml",
            "toml",
            "swift",
            "kotlin",
            "kt",
            "java",
            "c",
            "h",
            "ino",
            "cpp",
            "c++",
            "cc",
            "cxx",
            "hpp",
            "h++",
            "hh",
            "hxx",
            "c#",
            "cs",
          ].includes(languageName)
        )
          return null;
        if (languageName === "css") hasCssFence = true;
        if (["shell", "bash", "sh"].includes(languageName)) hasShellFence = true;
        if (languageName === "sql") hasSqlFence = true;
        if (["yaml", "yml"].includes(languageName)) hasYamlFence = true;
        if (languageName === "toml") hasTomlFence = true;
        if (["xml", "xsl", "xsd", "svg"].includes(languageName)) hasXmlFence = true;
        if (["ruby", "rb"].includes(languageName)) hasRubyFence = true;
        if (["js", "javascript", "ts", "typescript", "py", "python"].includes(languageName))
          hasInterpolatedFence = true;
      }
    } while (cursor.next());
    // Language-specific passes need extra work; use the fallback for larger blocks.
    if (
      (hasCssFence || hasShellFence || hasSqlFence || hasYamlFence || hasTomlFence || hasXmlFence || hasRubyFence) &&
      value.length > 6000
    )
      return null;
  }
  const emit = (from: number, to: number, classes: string) => {
    // Avoid creating thousands of DOM decorations while editing dense source.
    if (config.maxTokens !== undefined && ++tokenCount > config.maxTokens) {
      tooManyTokens = true;
      return;
    }
    // Yuque marks destructured property names as properties, including
    // identifiers that newer JavaScript grammars classify as definitions.
    if (classes === "semlo-editor-syntax-definition") {
      const definition = tree.resolveInner(from, 1);
      const parent = definition.parent;
      // A shorthand binding is also a property. In `name: alias`, the
      // first child is the property name and the alias remains a definition.
      if (parent?.name === "PatternProperty" && parent.firstChild?.from === definition.from) {
        classes = "semlo-editor-syntax-property";
      }
    }
    if (position < from) children.push({ type: "text", value: value.slice(position, from) });
    children.push({
      type: "element",
      tagName: "span",
      properties: {
        className: classes.includes(" ")
          ? classes.split(" ").flatMap((name) => (legacyClasses[name] ? [name, legacyClasses[name]] : [name]))
          : legacyClasses[classes]
            ? [classes, legacyClasses[classes]]
            : [classes],
      },
      children: [{ type: "text", value: value.slice(from, to) }],
    });
    position = to;
  };
  if (language === "vue" && value.includes("{{")) {
    const vueTree = vueParser.parse(value);
    const ranges: Array<{ from: number; to: number }> = [];
    const cursor = vueTree.cursor();
    do {
      if (cursor.name === "Interpolation" && value.slice(cursor.from, cursor.from + 2) === "{{") {
        // Incomplete interpolation falls back instead of inventing a closing token.
        if (value.slice(cursor.to - 2, cursor.to) !== "}}") return null;
        ranges.push({ from: cursor.from, to: cursor.to });
      }
    } while (cursor.next());
    const spans: Array<{ from: number; to: number; classes: string }> = [];
    let rangeIndex = 0;
    highlightTree(tree, config.highlighter, (from, to, classes) => {
      while (rangeIndex < ranges.length && ranges[rangeIndex].to <= from) rangeIndex++;
      const range = ranges[rangeIndex];
      if (!range || to <= range.from || from >= range.to) spans.push({ from, to, classes });
    });
    rangeIndex = 0;
    highlightTree(vueTree, javascriptHighlighter, (from, to, classes) => {
      while (rangeIndex < ranges.length && ranges[rangeIndex].to <= from) rangeIndex++;
      const range = ranges[rangeIndex];
      if (range && from >= range.from && to <= range.to) spans.push({ from, to, classes });
    });
    for (const range of ranges)
      spans.push({ from: range.from, to: range.from + 2, classes: "semlo-editor-syntax-punctuation" });
    spans.sort((a, b) => a.from - b.from || a.to - b.to);
    for (const span of spans) emit(span.from, span.to, span.classes);
  } else if (
    hasCssFence ||
    hasShellFence ||
    hasSqlFence ||
    hasYamlFence ||
    hasTomlFence ||
    hasXmlFence ||
    hasRubyFence ||
    hasInterpolatedFence
  ) {
    const fenceSyntax = (
      from: number,
    ): "css" | "shell" | "sql" | "yaml" | "toml" | "xml" | "ruby" | "interpolated" | null => {
      let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(from, 1);
      let inStyleSheet = false;
      let inFencedDocument = false;
      let inFencedScript = false;
      while (node) {
        if (node.name === "StyleSheet") inStyleSheet = true;
        if (node.name === "Document" && node.parent?.name === "FencedCode") inFencedDocument = true;
        if (node.name === "Script" && node.parent?.name === "FencedCode") inFencedScript = true;
        if (node.name === "FencedCode") {
          const info = node.getChild("CodeInfo");
          const name = info && value.slice(info.from, info.to).trim().split(/\s+/, 1)[0].toLowerCase();
          if (inStyleSheet && name === "css") return "css";
          if (inFencedDocument && name && ["shell", "bash", "sh"].includes(name)) return "shell";
          if (inFencedDocument && name === "sql") return "sql";
          if (inFencedDocument && name && ["yaml", "yml"].includes(name)) return "yaml";
          if (inFencedDocument && name === "toml") return "toml";
          if (inFencedDocument && name && ["xml", "xsl", "xsd", "svg"].includes(name)) return "xml";
          if (inFencedDocument && name && ["ruby", "rb"].includes(name)) return "ruby";
          if (inFencedScript && name && ["js", "javascript", "ts", "typescript", "py", "python"].includes(name))
            return "interpolated";
          return null;
        }
        node = node.parent;
      }
      return null;
    };
    const spans: Array<{ from: number; to: number; classes: string }> = [];
    highlightTree(tree, config.highlighter, (from, to, classes) => {
      if (!fenceSyntax(from)) spans.push({ from, to, classes });
    });
    if (hasCssFence)
      highlightTree(tree, cssHighlighter, (from, to, classes) => {
        if (fenceSyntax(from) === "css") spans.push({ from, to, classes });
      });
    if (hasShellFence)
      highlightTree(tree, shellHighlighter, (from, to, classes) => {
        if (fenceSyntax(from) === "shell") spans.push({ from, to, classes });
      });
    if (hasSqlFence)
      highlightTree(tree, cypherHighlighter, (from, to, classes) => {
        if (fenceSyntax(from) === "sql") spans.push({ from, to, classes });
      });
    if (hasYamlFence)
      highlightTree(tree, yamlHighlighter, (from, to, classes) => {
        if (fenceSyntax(from) === "yaml") spans.push({ from, to, classes });
      });
    if (hasTomlFence)
      highlightTree(tree, cypherHighlighter, (from, to, classes) => {
        if (fenceSyntax(from) === "toml") spans.push({ from, to, classes });
      });
    if (hasXmlFence)
      highlightTree(tree, markdownXmlHighlighter, (from, to, classes) => {
        if (fenceSyntax(from) === "xml") spans.push({ from, to, classes });
      });
    if (hasRubyFence)
      highlightTree(tree, markdownRubyHighlighter, (from, to, classes) => {
        if (fenceSyntax(from) === "ruby") spans.push({ from, to, classes });
      });
    if (hasInterpolatedFence)
      highlightTree(tree, markdownInterpolatedHighlighter, (from, to, classes) => {
        if (fenceSyntax(from) === "interpolated") spans.push({ from, to, classes });
      });
    spans.sort((a, b) => a.from - b.from || a.to - b.to);
    for (const span of spans) emit(span.from, span.to, span.classes);
  } else highlightTree(tree, config.highlighter, emit);
  if (tooManyTokens) return null;
  if (position < value.length) children.push({ type: "text", value: value.slice(position) });
  return { type: "root" as const, children };
}
