import { type Editor, type Range } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";

import { todayISO } from "../../shared/date/date-utils";
import { insertCalloutSiblingFromSlash } from "../blocks/toolbar-callout-insert";
import { readCalloutTonePreference } from "../blocks/toolbar-callout-preference";
import { insertStatus } from "../cards/status";
import { insertDatabase } from "../database/extension";
import { createCanvasContent } from "../drawing/canvas/model";
import { insertDiagram } from "../drawing/diagram/extension";
import { createMindmapContent } from "../drawing/mindmap/extension";
import { insertGallery } from "../media/gallery/extension";
import { insertEmbed } from "../references/embed";
import { insertMentionTrigger } from "../references/mention";
import { slashHistoryProbeKey } from "./keys";
import { recentIds, remember } from "./recent";
import { filterInsertCommands, isInsertCommandAllowed } from "./toolbar-insert-context";

export interface CommandItem {
  id: string;
  title: string;
  description: string;
  key: string;
  group: "basic" | "smart" | "canvas" | "data" | "layout" | "developer" | "local" | "tools" | "external";
  icon: string;
  shortcut?: string;
  disabled?: boolean;
  searchOnly?: boolean;
  run: (editor: Editor, range?: Range) => void;
}

function invoke(item: CommandItem, editor: Editor, range?: Range) {
  if (item.disabled || !isInsertCommandAllowed(editor.state, item.id, range?.from)) return;
  remember(editor, item.id);
  item.run(editor, range);
}
// Small illustrations are drawn locally; they don't depend on the reference runtime.
const cardIcons: Record<string, string> = {
  unavailable: '<rect x="4" y="4" width="24" height="24" rx="3"/><path d="M9 11h14M9 16h14M9 21h9"/>',
  image:
    '<rect x="3" y="4" width="26" height="24" rx="3"/><circle cx="11" cy="11" r="2" fill="#2dbb79" stroke="none"/><path d="m5 24 8-8 4 4 4-5 6 9"/>',
  table:
    '<rect x="3" y="4" width="26" height="24" rx="2"/><path d="M3 10h26M3 16h26M3 22h26M11 4v24M20 4v24"/><path d="M5 7h4" stroke="#2dbb79"/>',
  attachment:
    '<path d="M3 10h10l3 3h13v11a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2z"/><path d="M3 10V8a2 2 0 0 1 2-2h8l3 3h10v4"/><path d="m15 21 4-4a2 2 0 0 1 3 3l-5 5a3 3 0 0 1-4-4l4-4" stroke="#2dbb79"/>',
  status:
    '<path d="M9 4h11l7 8-3 14-12 2-5-13z"/><circle cx="15" cy="10" r="2"/><path d="m12 23 11-2" stroke="#2dbb79"/>',
  quote:
    '<path d="M5 4v24" stroke="#9aa5a0" stroke-width="2"/><path d="M11 8h16M11 13h13M11 18h16M11 23h9" stroke="#c9cecb"/>',
  divider: '<path d="M4 7h24M4 25h24" stroke="#d4d8d5"/><path d="M4 16h24"/>',
  callout:
    '<rect x="3" y="5" width="26" height="22" rx="2" fill="#e5f1ff" stroke="none"/><path d="M8 12h17M8 17h12M8 22h17" stroke="#6ea9f7"/>',
  columns:
    '<rect x="3" y="5" width="11" height="22" rx="2"/><rect x="18" y="5" width="11" height="22" rx="2"/><path d="M16 5v22" stroke="#d2d6d4"/>',
  details: '<path d="m5 8 6 4-6 4z" fill="#333" stroke="none"/><path d="M15 10h13M5 21h23M5 26h18" stroke="#c9cecb"/>',
  code: '<path d="M5 4h22v24H5z" stroke="#bbc2be"/><path d="M9 9h4m3 0h7M9 14h4m3 0h9M9 19h4m3 0h6M9 24h4m3 0h8" stroke="#c9cecb"/><path d="M16 14h5" stroke="#f0804e"/><path d="M16 19h7" stroke="#5599d6"/>',
  math: '<path d="M24 5H9l8 10-8 12h15M21 20l5 6m0-6-5 6"/>',
  date: '<rect x="5" y="6" width="22" height="22" rx="2"/><path d="M5 12h22M10 3v6M22 3v6M10 17h4M18 17h4M10 22h4"/>',
  calendar:
    '<rect x="4" y="5" width="24" height="23" rx="2"/><path d="M4 11h24M10 3v5M22 3v5M4 17h24M4 23h24M12 11v17M20 11v17"/>',
  emoji:
    '<circle cx="16" cy="16" r="12"/><circle cx="12" cy="13" r="1" fill="currentColor"/><circle cx="20" cy="13" r="1" fill="currentColor"/><path d="M10 19c2 5 10 5 12 0"/>',
  mention: '<path d="M22 21c-2 3-9 3-12 1-5-3-4-11 0-14 4-3 12-2 13 4v5c0 3-4 3-4 0v-5m0 0c-1-4-7-4-8 1-1 5 5 8 8 4"/>',
  localFile: '<path d="M7 3h12l6 6v20H7zM19 3v6h6M11 15h10M11 20h10M11 25h7"/>',
  video: '<rect x="3" y="6" width="26" height="20" rx="2"/><path d="m13 11 8 5-8 5z" fill="#2dbb79" stroke="none"/>',
  audio: '<path d="M20 4v18a4 4 0 1 1-2-3.5V8l8-2v13a4 4 0 1 1-2-3.5V3z"/>',
};
// These entries mirror the current block menu, but are disabled until their
// backing integrations and document types are implemented.
function unavailableBlockCommands(): CommandItem[] {
  const entries: Array<[string, string, string, CommandItem["group"], string?]> = [
    ["ai", "语雀 AI 助手-写作助手", "把文本变成表格、代码块等", "smart"],
  ];
  return entries.map(([id, title, description, group, shortcut]) => ({
    id,
    title,
    description,
    group,
    shortcut,
    key: `${title} ${id} ${shortcut ?? ""}`,
    icon: "",
    disabled: true,
    run: () => {},
  }));
}
export type InteractiveKind = "vote" | "checkin" | "yuque" | "encrypted";
export type InteractiveAction = (kind: InteractiveKind, range?: Range) => void;
function interactiveCommands(
  action: InteractiveAction | undefined,
  available: ((kind: InteractiveKind) => boolean) | undefined,
): CommandItem[] {
  return (
    [
      ["vote", "投票", "发起投票活动", "/toup"],
      ["checkin", "打卡", "发起打卡活动", "/dk"],
      ["yuque", "语雀内容", "选择文档或表格链接", "/yq"],
      ["encrypted", "加密文本", "使用接入方提供的加密服务", "/jm"],
    ] as const
  ).map(([id, title, description, shortcut]) => ({
    id,
    title,
    description,
    shortcut,
    key: `${title} ${id} ${shortcut}`,
    group: "tools" as const,
    icon: "",
    disabled: !action || !available?.(id),
    run: (_editor: Editor, range?: Range) => action?.(id, range),
  }));
}
type Chain = ReturnType<Editor["chain"]>;
const action = (command: (chain: Chain) => Chain) => (editor: Editor, range?: Range) => {
  const probe = editor.can().chain().focus();
  if (range) probe.deleteRange(range);
  if (!command(probe).run()) return;
  const chain = editor.chain().focus();
  if (range) {
    chain
      .command(({ tr }) => {
        if (
          slashHistoryProbeKey.getState(editor.state)?.trusted &&
          slashHistoryProbeKey.getState(editor.state)?.reopenFrom === range.from
        ) {
          closeHistory(tr);
          tr.setMeta("semloEditorSlashHistoryProbe", { before: editor.state.doc, range });
        }
        return true;
      })
      .deleteRange(range);
  }
  command(chain).run();
};
function blockCard(editor: Editor, type: "callout" | "details", range?: Range) {
  const preferredTone = type === "callout" ? readCalloutTonePreference(editor.view.dom.ownerDocument) : null;
  const attrs = preferredTone ? { tone: preferredTone } : {};
  if (type === "callout" && insertCalloutSiblingFromSlash(editor, range, attrs) !== "not-applicable") return;
  const command = type === "callout" ? action((c) => c.toggleWrap("callout", attrs)) : action((c) => c.setDetails());
  const probe = editor.can().chain().focus();
  if (range) probe.deleteRange(range);
  if ((type === "callout" ? probe.toggleWrap("callout", attrs) : probe.setDetails()).run()) {
    command(editor, range);
    return;
  }
  const { $from } = editor.state.selection;
  let position = $from.depth ? $from.after($from.depth) : editor.state.selection.to;
  const chain = editor.chain().focus();
  if (range) {
    chain.deleteRange(range);
    position -= range.to - range.from;
  }
  const content =
    type === "callout"
      ? { type: "callout", attrs, content: [{ type: "paragraph" }] }
      : {
          type: "details",
          attrs: { open: true },
          content: [{ type: "detailsSummary" }, { type: "detailsContent", content: [{ type: "paragraph" }] }],
        };
  chain.insertContentAt(position, content).run();
}
function insertColumns(count: number) {
  return action((chain) =>
    chain.insertContent({
      type: "semloEditorColumns",
      content: Array.from({ length: count }, () => ({ type: "semloEditorColumn", content: [{ type: "paragraph" }] })),
    }),
  );
}
function insertFormula(editor: Editor, range?: Range, block = false) {
  const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  action((chain) =>
    chain.insertContent({ type: block ? "semloEditorBlockFormula" : "semloEditorFormula", attrs: { latex: "", id } }),
  )(editor, range);
  const target = editor.view.dom.querySelector<HTMLElement>(`[data-formula-id="${id}"]`);
  target?.dispatchEvent(new (editor.view.dom.ownerDocument.defaultView?.Event ?? Event)("semlo-editor:open-formula"));
}
function commands(
  openImage: () => void,
  openAttachment: () => void,
  openEmoji: () => void,
  openMedia: (kind: "video" | "audio") => void,
): CommandItem[] {
  return [
    {
      id: "canvas",
      title: "画板",
      description: "可插入图形、连线和图片等",
      key: "画板 canvas hb",
      shortcut: "/hb",
      group: "canvas",
      icon: "▧",
      run: action((c) => c.insertContent(createCanvasContent("board"))),
    },
    {
      id: "mindmap",
      title: "思维导图",
      description: "用于梳理信息和头脑风暴",
      key: "思维导图 mindmap swdt",
      shortcut: "/swdt",
      group: "canvas",
      icon: "▧",
      run: action((c) => c.insertContent(createMindmapContent())),
    },
    {
      id: "flowchart",
      title: "流程图",
      description: "用于绘制流程",
      key: "流程图 flowchart lct",
      shortcut: "/lct",
      group: "canvas",
      icon: "▧",
      run: action((c) => c.insertContent(createCanvasContent("flowchart"))),
    },
    {
      id: "uml",
      title: "UML图",
      description: "支持用例图、类图、时序图等",
      key: "UML图 uml",
      shortcut: "/uml",
      group: "developer",
      icon: "▧",
      run: action((c) => c.insertContent(createCanvasContent("uml"))),
    },
    {
      id: "image",
      title: "图片",
      description: "插入图片",
      key: "图片 image tupian tp",
      group: "basic",
      icon: "▧",
      run: (editor, range) => {
        if (range) editor.chain().focus().deleteRange(range).run();
        openImage();
      },
    },
    {
      id: "table",
      title: "表格",
      description: "插入表格",
      key: "表格 table biaoge bg",
      group: "basic",
      icon: "▦",
      run: action((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: false })),
    },
    {
      id: "attachment",
      title: "附件",
      description: "插入附件",
      key: "附件 file fujian fj",
      group: "basic",
      icon: "▱",
      run: (editor, range) => {
        if (range) editor.chain().focus().deleteRange(range).run();
        openAttachment();
      },
    },
    {
      id: "status",
      title: "状态",
      description: "插入状态",
      key: "状态 status zhuangtai zt",
      group: "basic",
      icon: "◇",
      run: insertStatus,
    },
    {
      id: "database",
      title: "数据表",
      description: "支持数据的筛选、分组和排序",
      key: "数据表 database shujubiao sjb",
      shortcut: "/sjb",
      group: "data",
      icon: "▦",
      run: insertDatabase,
    },
    {
      id: "album",
      title: "画册",
      description: "用于展示图片集",
      key: "画册 album huace hc",
      shortcut: "/hc",
      group: "data",
      icon: "▧",
      run: (editor, range) => insertDatabase(editor, range, "gallery"),
    },
    {
      id: "kanban",
      title: "看板",
      description: "用于任务管理",
      key: "看板 kanban kanban kb",
      shortcut: "/kb",
      group: "data",
      icon: "▥",
      run: (editor, range) => insertDatabase(editor, range, "kanban"),
    },
    {
      id: "quote",
      title: "引用",
      description: "插入引用格式",
      key: "引用 quote yinyong yy",
      shortcut: "/yy",
      group: "layout",
      icon: "❝",
      run: action((c) => c.toggleBlockquote()),
    },
    {
      id: "divider",
      title: "插入分割线",
      description: "分割线",
      key: "分割线 divider fengexian fgx",
      shortcut: "/fgx",
      group: "layout",
      icon: "—",
      run: action((c) => c.setHorizontalRule()),
    },
    {
      id: "callout",
      title: "高亮块",
      description: "用彩色背景来高亮提示",
      key: "高亮 提示 callout gaoliangkuai glk",
      shortcut: "/glk",
      group: "layout",
      icon: "☰",
      run: (editor, range) => blockCard(editor, "callout", range),
    },
    {
      id: "columns",
      title: "分栏卡片",
      description: "使用分栏组织页面",
      key: "分栏 columns fenlan fl",
      group: "layout",
      icon: "◫",
      run: insertColumns(2),
    },
    ...([2, 3, 4] as const).map((count) => ({
      id: `columns${count}`,
      title: ["", "", "两栏", "三栏", "四栏"][count],
      description: "使用分栏组织页面",
      key: `fl${count} ${count}栏 ${["", "", "两栏", "三栏", "四栏"][count]}`,
      shortcut: `/fl${count}`,
      group: "layout" as const,
      icon: "◫",
      searchOnly: true,
      run: insertColumns(count),
    })),
    {
      id: "details",
      title: "折叠块",
      description: "可折叠内容",
      key: "折叠 details toggle zhediekuai zdk",
      shortcut: "/zdk",
      group: "layout",
      icon: "▸",
      run: (editor, range) => blockCard(editor, "details", range),
    },
    {
      id: "code",
      title: "代码块",
      description: "支持多种语言和主题切换",
      key: "代码 code daima dmk",
      shortcut: "/dmk",
      group: "developer",
      icon: "</>",
      run: action((c) => c.toggleCodeBlock()),
    },
    {
      id: "math",
      title: "公式",
      description: "支持 LaTeX 语法",
      key: "公式 math formula gongshi gs",
      shortcut: "/gs",
      group: "developer",
      icon: "∑",
      run: insertFormula,
    },
    {
      id: "blockMath",
      title: "块级公式",
      description: "独立一行显示 TeX 公式",
      key: "块级公式 block formula kuai gongshi gsk",
      shortcut: "/gsk",
      group: "developer",
      icon: "∑",
      run: (editor, range) => insertFormula(editor, range, true),
    },
    {
      id: "diagram",
      title: "文本绘图",
      description: "支持 PlantUML、Mermaid 等",
      key: "文本绘图 diagram plantuml mermaid wenben huitu wbht",
      shortcut: "/wbht",
      group: "developer",
      icon: "▤",
      run: insertDiagram,
    },
    {
      id: "localFile",
      title: "本地文件",
      description: "支持 Office、PDF、Sketch 等",
      key: "本地文件 local file benduwenjian bdwj",
      shortcut: "/bdwj",
      group: "local",
      icon: "▤",
      run: (editor, range) => {
        if (range) editor.chain().focus().deleteRange(range).run();
        openAttachment();
      },
    },
    {
      id: "video",
      title: "本地视频",
      description: "视频导入",
      key: "本地视频 video shipin sp",
      shortcut: "/sp",
      group: "local",
      icon: "▶",
      run: (editor, range) => {
        if (range) editor.chain().focus().deleteRange(range).run();
        openMedia("video");
      },
    },
    {
      id: "audio",
      title: "本地音频",
      description: "音频导入",
      key: "本地音频 audio yinpin yp",
      shortcut: "/yp",
      group: "local",
      icon: "♪",
      run: (editor, range) => {
        if (range) editor.chain().focus().deleteRange(range).run();
        openMedia("audio");
      },
    },
    {
      id: "mention",
      title: "提及",
      description: "提及人和内容",
      key: "提及 mention tiji tj",
      shortcut: "@",
      group: "tools",
      icon: "@",
      run: insertMentionTrigger,
    },
    {
      id: "calendar",
      title: "日历",
      description: "使用日历添加日程",
      key: "日历 calendar rili rl",
      shortcut: "/rl",
      group: "tools",
      icon: "日",
      run: action((c) => c.insertContent({ type: "semloEditorCalendar" })),
    },
    {
      id: "date",
      title: "日期",
      description: "插入日期",
      key: "日期 date riqi rq",
      shortcut: "/rq",
      group: "tools",
      icon: "日",
      run: action((c) => c.insertContent({ type: "semloEditorDate", attrs: { date: todayISO() } })),
    },
    {
      id: "bilibili",
      title: "哔哩哔哩",
      description: "",
      key: "哔哩哔哩 bilibili b站 blbl",
      shortcut: "/blbl",
      group: "external",
      icon: "",
      run: (editor, range) => insertEmbed(editor, "bilibili", range),
    },
    {
      id: "codepen",
      title: "CodePen",
      description: "",
      key: "CodePen cod",
      shortcut: "/cod",
      group: "external",
      icon: "",
      run: (editor, range) => insertEmbed(editor, "codepen", range),
    },
    {
      id: "figma",
      title: "Figma",
      description: "",
      key: "Figma fig",
      shortcut: "/fig",
      group: "external",
      icon: "",
      run: (editor, range) => insertEmbed(editor, "figma", range),
    },
    {
      id: "netease",
      title: "网易云音乐",
      description: "",
      key: "网易云音乐 netease wyyyy",
      shortcut: "/wyyyy",
      group: "external",
      icon: "",
      run: (editor, range) => insertEmbed(editor, "netease", range),
    },
    ...(
      [
        ["youku", "优酷", "/yk"],
        ["canva", "Canva", "/can"],
        ["processon", "ProcessOn", "/pro"],
        ["juejin", "码上掘金", "/msjj"],
        ["taobao", "淘宝视频", "/tbsp"],
        ["modao", "墨刀", "/md"],
        ["jinshuju", "金数据", "/jsj"],
        ["amap", "高德地图", "/gddt"],
        ["yida", "宜搭", "/yd"],
      ] as const
    ).map(([id, title, shortcut]) => ({
      id,
      title,
      description: "",
      key: `${title} ${id} ${shortcut}`,
      shortcut,
      group: "external" as const,
      icon: "",
      run: (editor: Editor, range?: Range) => insertEmbed(editor, id, range),
    })),
    {
      id: "emoji",
      title: "表情",
      description: "用 emoji 表情表达情绪",
      key: "表情 emoji biaoqing bq",
      shortcut: "/bq",
      group: "layout",
      icon: "☺",
      run: (editor, range) => {
        if (range) editor.chain().focus().deleteRange(range).run();
        openEmoji();
      },
    },
    {
      id: "gallery",
      title: "图册",
      description: "轮播、平铺等方式展示多图",
      key: "图册 gallery tuce tc",
      shortcut: "/tc",
      group: "layout",
      icon: "▧",
      run: insertGallery,
    },
  ];
}
function matchingCommands(
  openImage: () => void,
  openAttachment: () => void,
  openEmoji: () => void,
  openMedia: (kind: "video" | "audio") => void,
  query = "",
  interactive?: InteractiveAction,
  interactiveAvailable?: (kind: InteractiveKind) => boolean,
) {
  const normalized = query.trim().toLowerCase();
  return [
    ...commands(openImage, openAttachment, openEmoji, openMedia),
    ...interactiveCommands(interactive, interactiveAvailable),
  ].filter((item) => (normalized ? item.key.toLowerCase().includes(normalized) : !item.searchOnly));
}
function linkCommand(openLink: (range?: Range) => void): CommandItem {
  return {
    id: "link",
    title: "链接",
    description: "插入链接",
    key: "链接 link",
    group: "tools",
    icon: "↗",
    run: (_editor, range) => openLink(range),
  };
}
function searchableQuickCommands(openLink: (range?: Range) => void, query: string, includeAll = false): CommandItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized && !includeAll) return [];
  const entries: CommandItem[] = [
    {
      id: "paragraph",
      title: "p 文本",
      description: "普通文本",
      key: "p 文本 paragraph",
      group: "basic",
      icon: "T",
      shortcut: "/p",
      run: (editor, range) => {
        if (range)
          editor
            .chain()
            .focus()
            .command(({ tr }) => {
              if (
                slashHistoryProbeKey.getState(editor.state)?.trusted &&
                slashHistoryProbeKey.getState(editor.state)?.reopenFrom === range.from
              ) {
                closeHistory(tr);
                tr.setMeta("semloEditorSlashHistoryProbe", { before: editor.state.doc, range });
              }
              return true;
            })
            .deleteRange(range)
            .setParagraph()
            .run();
      },
    },
    { ...linkCommand(openLink), key: "链接 link lj", shortcut: "/lj" },
    ...([1, 2, 3, 4, 5, 6] as const).map((level): CommandItem => ({
      id: `heading${level}`,
      title: `标题${level}`,
      description: `转换为标题 ${level}`,
      key: "标题 heading h1 h2 h3 h4 h5 h6",
      group: "basic",
      icon: `H${level}`,
      run: action((chain) => chain.setHeading({ level })),
    })),
    {
      id: "inlineCode",
      title: "行内代码",
      description: "插入行内代码",
      key: "行内代码 inline code hndm h1",
      group: "basic",
      icon: "</>",
      shortcut: "/hndm",
      run: action((chain) => chain.toggleCode()),
    },
    ...(
      [
        ["bulletList", "无序列表", "wxlb", "☷", action((chain) => chain.toggleBulletList())],
        ["orderedList", "有序列表", "wxlb yxlb", "≡", action((chain) => chain.toggleOrderedList())],
        ["taskList", "任务列表", "wxlb rwlb", "☑", action((chain) => chain.toggleTaskList())],
      ] as const
    ).map(([id, title, key, icon, run]): CommandItem => ({
      id,
      title,
      description: title,
      key: `${title} ${key}`,
      group: "basic",
      icon,
      run,
    })),
  ];
  const matching = entries.filter((item) => item.key.toLowerCase().includes(normalized));
  const exactHeading = /^h([1-6])$/.exec(normalized);
  if (exactHeading)
    matching.sort(
      (a, b) => Number(b.id === `heading${exactHeading[1]}`) - Number(a.id === `heading${exactHeading[1]}`),
    );
  return matching;
}
function recentCommands(
  editor: Editor,
  openImage: () => void,
  openAttachment: () => void,
  openEmoji: () => void,
  openMedia: (kind: "video" | "audio") => void,
  openLink: (range?: Range) => void,
  interactive?: InteractiveAction,
  interactiveAvailable?: (kind: InteractiveKind) => boolean,
): CommandItem[] {
  const candidates = [
    ...[
      ...commands(openImage, openAttachment, openEmoji, openMedia),
      ...interactiveCommands(interactive, interactiveAvailable),
    ].filter((item) => !item.searchOnly && !item.disabled),
    ...searchableQuickCommands(openLink, "", true),
  ];
  const byId = new Map(candidates.map((item) => [item.id, item]));
  return filterInsertCommands(
    editor.state,
    recentIds(editor.view.dom.ownerDocument).flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    }),
  );
}
function quickCommands(
  openLink: (range?: Range) => void,
): Array<{ title: string; glyph: string; run: (editor: Editor, range?: Range) => void }> {
  return [
    { title: "正文", glyph: "T", run: action((c) => c.setParagraph()) },
    ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
      title: `标题${level}`,
      glyph: `H${level}`,
      run: action((c) => c.setHeading({ level })),
    })),
    { title: "无序列表", glyph: "☷", run: action((c) => c.toggleBulletList()) },
    { title: "有序列表", glyph: "≡", run: action((c) => c.toggleOrderedList()) },
    { title: "待办事项", glyph: "☑", run: action((c) => c.toggleTaskList()) },
    { title: "链接", glyph: "↗", run: (editor, range) => invoke(linkCommand(openLink), editor, range) },
    { title: "代码块", glyph: "</>", run: action((c) => c.toggleCodeBlock()) },
  ];
}

export {
  cardIcons,
  unavailableBlockCommands,
  matchingCommands,
  searchableQuickCommands,
  recentCommands,
  quickCommands,
  invoke,
  insertColumns,
};
