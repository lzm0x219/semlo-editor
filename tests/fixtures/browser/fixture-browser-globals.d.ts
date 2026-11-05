import type { createEditor } from "../../../packages/core/src/index";

type TestEditor = ReturnType<typeof createEditor>;
type TestFont = { family: string; fullName?: string; style?: string; postscriptName?: string };
type FontRequest = { resolve: (fonts: TestFont[]) => void; reject: (reason?: unknown) => void };

declare global {
  interface SemloBrowserFixtureGlobals {
    createListDragSeedsEditor?: typeof import("../../../packages/core/src/index").createEditor;
    listSeedsEditor?: TestEditor;
    mindmapTest?: {
      editor: import("@tiptap/core").Editor;
      createCanvasContent: typeof import("../../../packages/core/src/features/drawing/canvas/model").createCanvasContent;
      createMindmapContent: typeof import("../../../packages/core/src/features/drawing/mindmap/extension").createMindmapContent;
      undo(): boolean;
      redo(): boolean;
    };
    canvasEditor?: TestEditor;
    dragPathEditor?: TestEditor;
    pathEditor?: TestEditor;
    integrationEditor?: TestEditor;
    styleEditor?: import("@tiptap/core").Editor;
    Editor?: typeof import("@tiptap/core").Editor;
    StarterKit?: ReturnType<
      typeof import("../../../packages/core/src/editor/starter-kit").createStarterKitWithCodeFonts
    >;
    ParagraphLayout?: typeof import("../../../packages/core/src/features/text/paragraph-layout").ParagraphLayout;
    OrderedListStyles?: typeof import("../../../packages/core/src/features/list/ordered-style").OrderedListStyles;
    setOrderedListStyle?: typeof import("../../../packages/core/src/features/list/ordered-style").setOrderedListStyle;
    serializeOrderedListStyles?: typeof import("../../../packages/core/src/features/list/ordered-style").serializeOrderedListStyles;
    serializeOrderedListOrdinals?: typeof import("../../../packages/core/src/features/text/paragraph-layout").serializeOrderedListOrdinals;
    blockClipboard?: {
      mode: "ok" | "deny" | "plain-only" | "pending";
      writes: Array<{ text: string; html?: string }>;
      resolve: (() => void) | null;
    };
    tableListenerTrace?: { enabled: boolean; start(): void; stop(): number; restore(): void };
    mentionRequests?: Array<{
      query: string;
      signal: AbortSignal;
      resolve: (items: import("../../../packages/core/src/types").MentionItem[]) => void;
      reject: (reason?: unknown) => void;
    }>;
    originalNodeDispatch?: TestEditor["editor"]["view"]["dispatch"];
    raceAliases?: string[];
    startDelayed?: () => void;
    revealLate?: (fonts: TestFont[]) => void;
    scopeLateResolve?: (fonts: TestFont[]) => void;
    imageClipboard?: ClipboardItem[];
    fontShortcutEvents?: Array<{ code: string; prevented: boolean }>;
    fontShortcutFixture?: {
      create(id: string, content: import("@tiptap/core").Content, editable?: boolean): void;
      platform(value: string): void;
      select(id: string, first: string, firstOffset: number, last: string, lastOffset: number, reverse?: boolean): void;
      snapshot(id: string): import("@tiptap/core").JSONContent;
      editable(id: string, value: boolean): void;
      focused(id: string): boolean;
      destroyed(id: string): void;
      cleanup(): void;
    };
    blockApi?: TestEditor;
    secondBlockApi?: TestEditor;
    blockCreateEditor?: typeof createEditor;
    calendarApi?: TestEditor;
    calendarReplacementApi?: TestEditor;
    codeFontApi?: TestEditor;
    codeTest?: TestEditor;
    coexistApi?: TestEditor;
    copyApi?: TestEditor;
    dialogApi?: TestEditor;
    emphasisCreate?: typeof createEditor;
    emphasisFirst?: TestEditor;
    emphasisSecond?: TestEditor;
    emphasisReloaded?: TestEditor;
    emphasisRace?: TestEditor;
    foldApi?: TestEditor;
    fontApi?: TestEditor;
    imageApi?: TestEditor;
    insertApi?: TestEditor;
    integratedSize?: TestEditor;
    layoutApi?: TestEditor;
    linkApi?: TestEditor;
    mentionApi?: TestEditor;
    mentionEmptyApi?: TestEditor;
    mentionErrorApi?: TestEditor;
    menuTest?: TestEditor;
    nodeFontApi?: TestEditor;
    outlineApi?: TestEditor;
    outlineOff?: TestEditor;
    painterApi?: TestEditor;
    painterSecond?: TestEditor;
    createPainterEditor?: typeof createEditor;
    recentApi?: TestEditor;
    recentSecond?: TestEditor;
    resizeApi?: TestEditor;
    revealApi?: TestEditor;
    scopeApi?: TestEditor;
    tableTests?: Partial<Record<string, TestEditor>>;
    blockBaselineHandles?: number;
    blockChanges?: number;
    coexistChanges?: number;
    foldChanges?: number;
    fontCalls?: number;
    fontEnumerationCount?: number;
    insertChanges?: number;
    outlineChanges?: number;
    unexpectedFontReads?: number;
    fontMode?: "ok" | "denied" | "pending";
    codeFontErrors?: string[];
    fontErrors?: string[];
    mentionErrors?: string[];
    copied?: string;
    codeFontCopied?: string;
    imageText?: string;
    emphasisFonts?: TestFont[];
    emphasisRequest?: { status: "pending" | "rejected"; message?: string };
    revealFonts?: TestFont[];
    fontResolvers?: Array<(fonts: TestFont[]) => void>;
    revealRequests?: FontRequest[];
    reads?: Array<FontRequest & { activated: boolean }>;
    queryLocalFonts?: () => Promise<TestFont[]>;
    emphasisOriginal?: () => Promise<TestFont[]>;
    oldCalendarTitle?: HTMLInputElement;
    selectedFileInput?: HTMLInputElement;
    layoutFunctions?: typeof import("./fixture-browser-entry");
    foldPos?: (text: string) => number;
  }
  type SemloNumericFixtureKey = {
    [K in keyof Window]-?: NonNullable<Window[K]> extends number ? K : never;
  }[keyof Window];
  interface Window extends SemloBrowserFixtureGlobals {
    __semloRequireFixture<K extends keyof Window>(key: K): NonNullable<Window[K]>;
    __semloRequireValue<T>(value: T, name: string): NonNullable<T>;
    __semloRequireDefined<K extends keyof Window>(key: K): Exclude<Window[K], undefined>;
    __semloIncrementFixture(key: SemloNumericFixtureKey): number;
    __semloRequireTableEditor(id: string): TestEditor;
  }
}
export {};
