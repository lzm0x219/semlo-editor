import type { EditorContent } from "@semlo-editor/core";
import type { JSONContent } from "@tiptap/core";

import { createDatabaseId } from "../packages/core/src/features/database/model";
import { createDemoDatabase } from "./database-example";

export interface DemoExample {
  id: string;
  title: string;
  description: string;
  content: EditorContent;
}

type Mark = { type: string; attrs?: Record<string, unknown> };
const text = (value: string, marks?: Mark[]): JSONContent => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (value?: string | JSONContent[]): JSONContent => ({
  type: "paragraph",
  ...(typeof value === "string" ? { content: [text(value)] } : value ? { content: value } : {}),
});
const heading = (level: number, value: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const document = (content: JSONContent[]): JSONContent => ({ type: "doc", content });
const listItem = (value: string): JSONContent => ({ type: "listItem", content: [paragraph(value)] });
const taskItem = (value: string, checked = false): JSONContent => ({
  type: "taskItem",
  attrs: { checked },
  content: [paragraph(value)],
});
const cell = (value: string, header = false): JSONContent => ({
  type: header ? "tableHeader" : "tableCell",
  content: [paragraph(value)],
});
const row = (values: string[], header = false): JSONContent => ({
  type: "tableRow",
  content: values.map((value) => cell(value, header)),
});
const sequenceCell = (value: string): JSONContent => ({ ...cell(value), attrs: { semloEditorSequence: 2 } });
const columns = (values: string[], widths?: number[]): JSONContent => ({
  type: "semloEditorColumns",
  ...(widths ? { attrs: { widths } } : {}),
  content: values.map((value) => ({ type: "semloEditorColumn", content: [paragraph(value)] })),
});
const diagram = (language: string, source: string): JSONContent => ({
  type: "semloEditorDiagram",
  attrs: { language, source, height: 300, preview: true },
});

// Static assets are bundled with the preview; no personal files or external media are needed.
const morning = new URL("./assets/morning.svg?url", import.meta.url).href;
const coast = new URL("./assets/coast.svg?url", import.meta.url).href;
const garden = new URL("./assets/garden.svg?url", import.meta.url).href;
const attachment = new URL("./assets/notes.txt?url", import.meta.url).href;
const video = new URL("./assets/preview.mp4?url", import.meta.url).href;
const audio = new URL("./assets/preview.wav?url", import.meta.url).href;

const galleryImages = [
  { id: "morning", src: morning, title: "山间清晨", href: "" },
  { id: "coast", src: coast, title: "海岸微风", href: "" },
  { id: "garden", src: garden, title: "花园午后", href: "" },
];
const gallery = (id: string, layout: "carousel" | "thumbnail" | "grid"): JSONContent => ({
  type: "semloEditorGallery",
  attrs: {
    data: {
      id,
      layout,
      images: galleryImages.map((image, index) => ({
        ...image,
        href: layout === "grid" && index === 0 ? "https://example.com/" : image.href,
      })),
    },
  },
});
const now = new Date();
const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = isoDate(now);
const tenth = isoDate(new Date(now.getFullYear(), now.getMonth(), 10));
const firstSaturday = new Date(now.getFullYear(), now.getMonth(), 1);
firstSaturday.setDate(firstSaturday.getDate() + ((6 - firstSaturday.getDay() + 7) % 7));
const followingMonday = new Date(firstSaturday.getFullYear(), firstSaturday.getMonth(), firstSaturday.getDate() + 2);

const start = document([
  heading(1, "在这里，开始写作"),
  paragraph([
    text("一段文字可以是一个想法的起点。选中文字，试试工具栏；在新的一行输入 "),
    text("/", [{ type: "code" }]),
    text("，可以插入更多内容。"),
  ]),
  heading(2, "把想法写下来"),
  paragraph("编辑器支持标题、列表、引用、代码块和表格。你可以自由编辑这份示例，切换框架时内容会保留。"),
  { type: "bulletList", content: [listItem("记录一闪而过的灵感"), listItem("整理值得继续思考的问题")] },
  { type: "blockquote", content: [paragraph("先写下来，再慢慢完善。")] },
  paragraph(),
]);

const sections: Array<{ id: string; title: string; description: string; content: JSONContent }> = [
  {
    id: "text",
    title: "文字与标题",
    description: "标题、文本样式、颜色、字体、字号、链接与段落排版。",
    content: document([
      heading(1, "文字与标题"),
      paragraph("从一段普通文字开始，选中文字即可调整样式。"),
      heading(2, "二级标题"),
      heading(3, "三级标题"),
      heading(4, "四级标题"),
      heading(5, "五级标题"),
      heading(6, "六级标题"),
      paragraph([
        text("粗体", [{ type: "bold" }]),
        text(" · "),
        text("斜体", [{ type: "italic" }]),
        text(" · "),
        text("下划线", [{ type: "underline" }]),
        text(" · "),
        text("删除线", [{ type: "strike" }]),
        text(" · "),
        text("行内代码", [{ type: "code" }]),
      ]),
      paragraph([
        text("文字颜色", [{ type: "textStyle", attrs: { color: "#e85d75" } }]),
        text(" · "),
        text("渐变文字", [
          { type: "textStyle", attrs: { semloEditorGradient: "linear-gradient(90deg, #2abcbf, #3836dd)" } },
        ]),
        text(" · "),
        text("荧光标记", [{ type: "highlight", attrs: { color: "#fff3a3" } }]),
      ]),
      paragraph([
        text("自定义透明文字", [{ type: "textStyle", attrs: { color: "rgba(219, 87, 72, 0.8)" } }]),
        text(" · "),
        text("自定义透明背景", [{ type: "highlight", attrs: { color: "rgba(112, 198, 180, 0.3)" } }]),
      ]),
      paragraph([
        text("其他渐变："),
        text("蓝紫", [
          { type: "textStyle", attrs: { semloEditorGradient: "linear-gradient(90deg, #2249fe, #c74aa8)" } },
        ]),
        text(" · "),
        text("橙粉", [
          { type: "textStyle", attrs: { semloEditorGradient: "linear-gradient(90deg, #ff6f04, #f330ab)" } },
        ]),
        text(" · "),
        text("金红", [
          { type: "textStyle", attrs: { semloEditorGradient: "linear-gradient(90deg, #f4aa06, #e54631)" } },
        ]),
      ]),
      paragraph([
        text("衬线字体", [{ type: "textStyle", attrs: { fontFamily: "serif" } }]),
        text(" · "),
        text("20 号文字", [{ type: "textStyle", attrs: { fontSize: "20px" } }]),
        text(" · H"),
        text("2", [{ type: "subscript" }]),
        text("O · x"),
        text("2", [{ type: "superscript" }]),
      ]),
      paragraph([
        text("链接："),
        text("访问语雀", [
          { type: "link", attrs: { href: "https://www.yuque.com/", target: "_blank", rel: "noopener noreferrer" } },
        ]),
      ]),
      heading(2, "编号标题"),
      paragraph("点击标题前的编号，可以切换编号样式。"),
      { ...heading(3, "准备工作"), attrs: { level: 3, semloEditorHeadingNumbering: "mixed" } },
      { ...heading(4, "整理清单"), attrs: { level: 4, semloEditorHeadingNumbering: "mixed" } },
      { ...heading(3, "下一步"), attrs: { level: 3, semloEditorHeadingNumbering: "mixed" } },
      heading(2, "段落排版"),
      { ...paragraph("居中对齐的段落"), attrs: { textAlign: "center" } },
      { ...paragraph("右对齐的段落"), attrs: { textAlign: "right" } },
      {
        ...paragraph("两端对齐让一段较长的正文在行首和行尾保持整齐。可以继续输入文字，观察段落换行后的排版。"),
        attrs: { textAlign: "justify" },
      },
      { ...paragraph("缩进一级的段落"), attrs: { semloEditorIndent: 1 } },
      { ...paragraph("这段文字使用两倍行高。"), attrs: { semloEditorLineHeight: "2" } },
      paragraph([text("同一段内的第一行"), { type: "hardBreak" }, text("按 Shift + Enter 可以在段内换行。")]),
      paragraph(),
    ]),
  },
  {
    id: "editing",
    title: "编辑操作",
    description: "练习格式刷、本机字体、查找替换、标题折叠和块操作。",
    content: document([
      heading(1, "编辑操作"),
      paragraph("下面的内容可以直接修改，试试编辑器中的常用操作。"),
      heading(2, "格式刷"),
      paragraph("选中下面的格式来源，点击工具栏的格式刷，再选中格式目标。双击格式刷可以连续使用，按 Esc 退出。"),
      paragraph([text("格式来源", [{ type: "bold" }, { type: "textStyle", attrs: { color: "#e85d75" } }])]),
      paragraph("格式目标"),
      heading(2, "本机字体"),
      paragraph(
        "选中文字后选择工具栏的字体，可以修改选区；没有选中文字时选择字体，会修改整篇文档。读取本机字体可能需要浏览器授权。",
      ),
      paragraph("选中这句话的一部分，试试不同字体。"),
      heading(2, "查找替换"),
      paragraph("打开工具栏的查找替换，或按 ⌘/Ctrl + F，搜索“青山”并试试替换。"),
      paragraph([text("青"), text("山", [{ type: "bold" }]), text("在远处，文字格式不同也可以一起查找。")]),
      paragraph("沿着小路走向青山。"),
      heading(2, "标题折叠与大纲"),
      paragraph("点击标题左侧的箭头可以收起下属内容；在右侧大纲中可以折叠层级或跳转到标题。"),
      heading(3, "一次短途旅行"),
      paragraph("把想去的地方和出发前要准备的事写下来。"),
      heading(4, "出发之前"),
      paragraph("查看天气，准备行囊。"),
      heading(3, "一本想读的书"),
      paragraph("记录书名和读完后的想法。"),
      heading(2, "块拖动与菜单"),
      paragraph("把指针移到下面的段落，拖动左侧操作柄调整顺序；点击操作柄可以打开块操作菜单。"),
      paragraph("先整理摘录。"),
      paragraph("再写下想法。"),
      heading(2, "快速插入"),
      paragraph("在下面的空行输入 /，打开插入菜单；也可以使用工具栏中的插入按钮。"),
      paragraph(),
    ]),
  },
  {
    id: "lists",
    title: "列表与表格",
    description: "多级列表、待办、表格、合并单元格及不同主题的代码块。",
    content: document([
      heading(1, "列表与表格"),
      heading(2, "无序列表"),
      { type: "bulletList", content: [listItem("收集灵感"), listItem("整理思路"), listItem("记录下一步")] },
      heading(2, "有序列表"),
      { type: "orderedList", content: [listItem("确定目标"), listItem("补充内容"), listItem("回顾与分享")] },
      heading(2, "多级列表"),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              paragraph("整理资料"),
              { type: "bulletList", content: [listItem("收集参考"), listItem("记录想法")] },
            ],
          },
          listItem("开始写作"),
        ],
      },
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              paragraph("准备内容"),
              { type: "orderedList", content: [listItem("收集素材"), listItem("整理提纲")] },
            ],
          },
          listItem("开始写作"),
        ],
      },
      heading(3, "列表项转标题"),
      paragraph(
        "将光标放在“编辑提纲”，选择工具栏的段落样式 → 标题3，或按 ⌥⌘3（Windows/Linux：Ctrl+Alt+3），再试试撤销。",
      ),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              paragraph("筹备写作"),
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [paragraph("编辑提纲"), { type: "bulletList", content: [listItem("梳理段落内容")] }],
                  },
                  listItem("安排发布时间"),
                ],
              },
            ],
          },
        ],
      },
      heading(2, "有序列表的缩进与编号"),
      paragraph("使用工具栏调整列表项缩进后，各层编号会分别递增。"),
      {
        type: "orderedList",
        content: [
          listItem("准备"),
          { ...listItem("收集资料"), attrs: { semloEditorListIndent: 1 } },
          { ...listItem("整理提纲"), attrs: { semloEditorListIndent: 1 } },
          listItem("开始写作"),
        ],
      },
      heading(2, "待办事项"),
      { type: "taskList", content: [taskItem("创建一篇文档", true), taskItem("继续完善示例"), taskItem("分享给团队")] },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              paragraph("准备分享"),
              { type: "taskList", content: [taskItem("检查正文"), taskItem("确认图片", true)] },
            ],
          },
        ],
      },
      { type: "blockquote", content: [paragraph("好的想法，值得被清楚地记录。")] },
      { type: "horizontalRule" },
      heading(2, "表格"),
      {
        type: "table",
        content: [
          row(["事项", "负责人", "进度"], true),
          row(["整理资料", "小语", "已完成"]),
          row(["完善文档", "小雀", "进行中"]),
        ],
      },
      heading(2, "合并单元格"),
      {
        type: "table",
        content: [
          { type: "tableRow", content: [cell("阶段", true), { ...cell("计划", true), attrs: { colspan: 2 } }] },
          row(["准备", "收集资料", "整理想法"]),
          row(["完成", "检查内容", "分享成果"]),
        ],
      },
      heading(2, "纵向合并与自适应宽度"),
      paragraph("此表格的第一列纵向合并，宽度会随编辑区域变化。"),
      {
        type: "table",
        attrs: { semloEditorFitWidth: true, semloEditorFitWidths: [1, 2, 1] },
        content: [
          row(["阶段", "事项", "进度"], true),
          {
            type: "tableRow",
            content: [{ ...cell("准备"), attrs: { rowspan: 2 } }, cell("整理资料"), cell("完成")],
          },
          { type: "tableRow", content: [cell("撰写文档"), cell("进行中")] },
        ],
      },
      heading(2, "标题行列与序号列"),
      paragraph("标题行列使用浅绿色；序号列会随行的增删调整。"),
      {
        type: "table",
        attrs: { semloEditorHeaderRow: true, semloEditorHeaderColumn: true, semloEditorHeaderBackground: "#E8F7CF" },
        content: [
          { type: "tableRow", content: [sequenceCell("序号"), cell("主题"), cell("备注")] },
          { type: "tableRow", content: [sequenceCell("1"), cell("整理灵感"), cell("记录想法")] },
          { type: "tableRow", content: [sequenceCell("2"), cell("回顾内容"), cell("补充细节")] },
        ],
      },
      heading(2, "隐藏边框"),
      paragraph("编辑时用虚线提示单元格边界，只读时隐藏边框。"),
      {
        type: "table",
        attrs: { semloEditorBorderHidden: true },
        content: [row(["一杯茶", "一段时间"]), row(["一本书", "一些想法"])],
      },
      heading(2, "代码块"),
      paragraph("可在代码块顶部切换语言和主题、折叠内容或复制代码；更多设置中可以调整行号和换行。"),
      {
        type: "codeBlock",
        attrs: { language: "typescript", title: "hello.ts", theme: "light", collapsed: false },
        content: [text("function greet(name: string) {\n  return `你好，${name}！`\n}\n\nconsole.log(greet('世界'))")],
      },
      {
        type: "codeBlock",
        attrs: { language: "javascript", title: "dark.js", theme: "dark", collapsed: false },
        content: [text("const note = '把想法写下来'\nconsole.log(note)")],
      },
      heading(3, "自动缩进"),
      paragraph("下面的代码故意没有缩进。点击代码块右上角的更多设置，再选择自动缩进。"),
      {
        type: "codeBlock",
        attrs: { language: "javascript", title: "indent.js", theme: "light", collapsed: false },
        content: [text("function formatExample(name) {\nif (name) {\nreturn name\n}\n}")],
      },
      heading(3, "折叠的代码块"),
      {
        type: "codeBlock",
        attrs: { language: "typescript", title: "folded.ts", theme: "light", collapsed: true },
        content: [text("const message = '点击箭头展开代码'\nconsole.log(message)")],
      },
      paragraph(),
    ]),
  },
  {
    id: "database",
    title: "数据表",
    description: "体验多种字段、表格、画册、看板、日历和图表视图，以及筛选和排序。",
    content: document([
      heading(1, "数据表"),
      paragraph("点击视图名称左侧的图标，可切换表格、画册、看板、日历和图表。表格可以横向滚动查看更多字段。"),
      paragraph("试试工具栏中的筛选、分组和排序，以及表格底部各列的统计。"),
      createDemoDatabase(now),
      paragraph(),
    ]),
  },
  ...(
    [
      {
        id: "database-gallery",
        title: "数据表：画册视图",
        kind: "gallery",
        description: "以画册卡片查看和编辑数据表记录。",
        instruction: "点击卡片可查看并编辑记录；切换视图可以继续使用同一份数据。",
      },
      {
        id: "database-board",
        title: "数据表：看板视图",
        kind: "kanban",
        description: "按状态分组，在看板中拖动任务。",
        instruction: "拖动卡片到其他状态，也可以点击卡片查看和编辑记录。",
      },
      {
        id: "database-calendar",
        title: "数据表：日历视图",
        kind: "calendar",
        description: "在日历中查看、移动和调整日程。",
        instruction: "拖动日程可更改日期，拖动日程两端可调整起止日期。",
      },
      {
        id: "database-chart",
        title: "数据表：图表视图",
        kind: "chart",
        description: "查看并配置已支持的十种数据图表。",
        instruction: "每个图表使用本数据表中的记录；可以编辑、复制、筛选和调整图表大小。",
      },
    ] as const
  ).map(({ id, title, kind, description, instruction }) => ({
    id,
    title,
    description,
    content: document([
      heading(1, title),
      paragraph(instruction),
      paragraph("这是独立示例；同一数据表的不同视图共享记录，其他分类示例各自保留修改。"),
      createDemoDatabase(now, kind),
      paragraph(),
    ]),
  })),
  {
    id: "blocks",
    title: "内容块与分栏",
    description: "状态、高亮块、折叠块，以及两栏、三栏和四栏布局。",
    content: document([
      heading(1, "内容块与分栏"),
      paragraph([
        text("项目状态："),
        { type: "semloEditorStatus", attrs: { label: "进行中", color: 4 } },
        text("  "),
        { type: "semloEditorStatus", attrs: { label: "已完成", color: 2 } },
      ]),
      paragraph([
        text("状态颜色："),
        ...["红色", "黄色", "绿色", "灰色", "蓝色", "紫色"].flatMap((label, color) => [
          { type: "semloEditorStatus", attrs: { label, color } },
          text(" "),
        ]),
      ]),
      paragraph("点击状态可修改文字和颜色；点击高亮块可打开配色。"),
      { type: "callout", attrs: { tone: "info" }, content: [paragraph("高亮块可以突出提示，也可以更换背景色。")] },
      { type: "callout", attrs: { tone: "green" }, content: [paragraph("这是另一种颜色的高亮块。")] },
      ...(
        [
          ["gray", "灰色"],
          ["cyan", "浅青"],
          ["lime", "黄绿"],
          ["yellow", "黄色"],
          ["orange", "橙色"],
          ["pink", "粉红"],
          ["mauve", "粉紫"],
          ["purple", "紫色"],
        ] as const
      ).map(([tone, label]): JSONContent => ({
        type: "callout",
        attrs: { tone },
        content: [paragraph(`${label}高亮块`)],
      })),
      {
        type: "details",
        attrs: { open: true },
        content: [
          { type: "detailsSummary", content: [text("点击展开或收起")] },
          { type: "detailsContent", content: [paragraph("折叠块里的内容也可以继续编辑。")] },
        ],
      },
      {
        type: "details",
        attrs: { open: false },
        content: [
          { type: "detailsSummary", content: [text("点击展开折叠的内容")] },
          { type: "detailsContent", content: [paragraph("这是最初收起的内容。")] },
        ],
      },
      heading(2, "两栏：不等宽"),
      columns(["较宽的左侧内容", "较窄的右侧内容"], [2, 1]),
      heading(2, "三栏"),
      columns(["第一栏", "第二栏", "第三栏"]),
      heading(2, "四栏"),
      columns(["一", "二", "三", "四"]),
      paragraph("拖动栏间的分隔线，可以调整宽度。"),
      paragraph(),
    ]),
  },
  {
    id: "formula",
    title: "公式与绘图",
    description: "行内与块级公式，以及四种文本绘图语言。",
    content: document([
      heading(1, "公式与绘图"),
      paragraph([
        text("行内公式：勾股定理 "),
        { type: "semloEditorFormula", attrs: { id: "inline-pythagoras", latex: "a^2+b^2=c^2" } },
        text(" 可以与正文一起排列。"),
      ]),
      paragraph("块级公式："),
      { type: "semloEditorBlockFormula", attrs: { id: "block-sum", latex: "\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}" } },
      paragraph("每张绘图卡片都可以切换语言，并在模板菜单中选择更多图形。"),
      heading(2, "PlantUML"),
      diagram(
        "plantuml",
        "@startuml\nactor 用户\nparticipant 编辑器\n用户 -> 编辑器: 输入内容\n编辑器 --> 用户: 显示结果\n@enduml",
      ),
      heading(2, "Mermaid"),
      diagram("mermaid", "flowchart TD\n  A[开始] --> B[记录想法]\n  B --> C[整理内容]\n  C --> D[完成]"),
      heading(2, "Flowchart"),
      diagram("flowchart", "start=>start: 开始\nedit=>operation: 编辑内容\nend=>end: 完成\nstart->edit->end"),
      heading(2, "Graphviz"),
      diagram(
        "graphviz",
        'digraph G {\n  rankdir=LR;\n  draft [label="草稿"];\n  done [label="完成", shape=doublecircle];\n  draft -> done [label="整理"];\n}',
      ),
      paragraph(),
    ]),
  },
  {
    id: "media",
    title: "图片图册与文件",
    description: "图片、三种图册版式、本地附件、音频和视频。",
    content: document([
      heading(1, "图片图册与文件"),
      paragraph(
        "选中图片可以旋转、裁剪、调整尺寸、样式、对齐、描述和链接；将指针移到图片上，可打开预览并切换正文中的图片。",
      ),
      heading(2, "正文图片：原样与居左"),
      {
        type: "paragraph",
        content: [
          { type: "image", attrs: { src: morning, alt: "山间清晨", title: "山间清晨", width: 560, height: 315 } },
        ],
      },
      heading(2, "正文图片：阴影、居中与描述"),
      {
        type: "paragraph",
        attrs: { textAlign: "center" },
        content: [
          {
            type: "image",
            attrs: {
              src: coast,
              alt: "海岸微风",
              title: "海岸微风",
              width: 400,
              height: 225,
              semloEditorCaption: "海岸微风 · 示例描述",
              semloEditorCaptionVisible: true,
              semloEditorImageHref: "https://example.com/",
              semloEditorImageOpenInCurrent: false,
              semloEditorImageStyle: "shadow",
            },
          },
        ],
      },
      heading(2, "正文图片：边框、居右与隐藏描述"),
      paragraph("选中下图，点击工具栏的描述按钮，可以恢复已经隐藏的描述；链接会在当前页面打开。"),
      {
        type: "paragraph",
        attrs: { textAlign: "right" },
        content: [
          {
            type: "image",
            attrs: {
              src: garden,
              alt: "花园午后",
              title: "花园午后",
              width: 400,
              height: 225,
              semloEditorCaption: "花园午后 · 隐藏的示例描述",
              semloEditorCaptionVisible: false,
              semloEditorImageHref: "https://example.com/",
              semloEditorImageOpenInCurrent: true,
              semloEditorImageStyle: "border",
            },
          },
        ],
      },
      heading(2, "正文图片：旋转"),
      paragraph("这张图片已逆时针旋转 90°，选中后可以继续旋转或使用撤销。"),
      {
        type: "paragraph",
        content: [
          {
            type: "image",
            attrs: {
              src: morning,
              alt: "旋转的山间清晨",
              width: 180,
              height: 320,
              semloEditorImageRotation: 270,
            },
          },
        ],
      },
      heading(2, "正文图片：裁剪"),
      paragraph("这张图片已裁剪，选中后可以重新调整裁剪范围，或还原完整图片。"),
      {
        type: "paragraph",
        content: [
          {
            type: "image",
            attrs: {
              src: garden,
              alt: "裁剪的花园午后",
              width: 240,
              height: 189,
              semloEditorImageCrop: { x: 0.25, y: 0.15, width: 0.5, height: 0.7 },
            },
          },
        ],
      },
      heading(2, "正文图片：图文混排"),
      paragraph([
        text("图片前的文字，"),
        { type: "image", attrs: { src: garden, alt: "段内花园", width: 160, height: 90 } },
        text("图片后的文字。可在图片两侧继续输入，或调整整段对齐。"),
      ]),
      heading(2, "轮播图册"),
      gallery("gallery-carousel", "carousel"),
      heading(2, "缩略图册"),
      gallery("gallery-thumbnail", "thumbnail"),
      heading(2, "网格图册"),
      paragraph("第一张图片带有示例链接，将鼠标移到图片上可以看到打开链接的按钮。"),
      gallery("gallery-grid", "grid"),
      heading(2, "附件"),
      paragraph([
        text("下载示例："),
        {
          type: "semloEditorAttachment",
          attrs: { href: attachment, name: "示例附件.txt", size: 127, mimeType: "text/plain" },
        },
      ]),
      heading(2, "音频"),
      { type: "semloEditorAudio", attrs: { src: audio, name: "示例音频.wav", size: 88278, mimeType: "audio/wav" } },
      heading(2, "视频"),
      { type: "semloEditorVideo", attrs: { src: video, name: "示例视频.mp4", size: 3009, mimeType: "video/mp4" } },
      paragraph(),
    ]),
  },
  {
    id: "tools",
    title: "日期日历与提及",
    description: "日期、时间、提及、表情与带示例日程的日历。",
    content: document([
      heading(1, "日期日历与提及"),
      paragraph([
        text("今天是 "),
        { type: "semloEditorDate", attrs: { id: "today", date: today, time: null } },
        text("，约在 "),
        { type: "semloEditorDate", attrs: { id: "meeting", date: today, time: "14:30" } },
        text(" 一起讨论。"),
      ]),
      paragraph([
        text("邀请 "),
        { type: "semloEditorMention", attrs: { id: "example-person", label: "小语（示例）", kind: "person" } },
        text(" 查看 "),
        { type: "semloEditorMention", attrs: { id: "example-document", label: "入门文档（示例）", kind: "document" } },
        text("。表情也可以直接插入正文 🌱 ✨"),
      ]),
      heading(2, "日历"),
      {
        type: "semloEditorCalendar",
        attrs: {
          events: [
            { id: "today-event", title: "整理灵感", start: today, end: today, description: "为文档补充想法", color: 1 },
            {
              id: "monthly-event",
              title: "本月回顾",
              start: tenth,
              end: tenth,
              description: "查看本月的记录",
              color: 4,
            },
            {
              id: "weekend-event",
              title: "周末阅读",
              start: isoDate(firstSaturday),
              end: isoDate(followingMonday),
              description: "给自己留一段阅读时间",
              color: 2,
            },
          ],
        },
      },
      paragraph(),
    ]),
  },
  {
    id: "embed",
    title: "第三方嵌入",
    description: "确认示例链接后，可加载哔哩哔哩与 CodePen 内容。",
    content: document([
      heading(1, "第三方嵌入"),
      paragraph("示例链接已填入下方，点击确定后加载对应内容。"),
      heading(2, "哔哩哔哩"),
      {
        type: "semloEditorEmbed",
        attrs: { provider: "bilibili", url: "", draft: "https://www.bilibili.com/video/av55895675" },
      },
      heading(2, "CodePen"),
      {
        type: "semloEditorEmbed",
        attrs: { provider: "codepen", url: "", draft: "https://codepen.io/Mamboleoo/pen/XWJPxpZ" },
      },
      paragraph(),
    ]),
  },
];

// Keep documents independent even when a consumer edits one of the exported objects.
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const combinedContent = sections.flatMap((section) => {
  const nodes = copy(section.content.content ?? []);
  // Every database in the combined example has its own transient view state.
  for (const database of nodes.filter((node) => node.type === "semloEditorDatabase"))
    if (database.attrs?.data) database.attrs.data.id = createDatabaseId();
  return nodes;
});
export const demoExamples: readonly DemoExample[] = [
  { id: "start", title: "快速开始", description: "从一份简短的示例文档开始。", content: start },
  {
    id: "custom-toolbar",
    title: "自定义工具栏",
    description: "使用自定义工具栏编辑标题、文字、链接和列表。",
    content: document([
      heading(1, "自定义工具栏"),
      paragraph("选中这段文字，试试加粗或添加链接。"),
      paragraph("把这一段变成二级标题。"),
      paragraph("把这一段变成列表。"),
    ]),
  },
  {
    id: "all",
    title: "综合示例",
    description: "在一篇文档中浏览全部已实现的编辑器内容。",
    content: document(combinedContent),
  },
  ...sections,
];
