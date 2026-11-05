import type { DiagramLanguage } from "./render";

export const diagramLanguages: ReadonlyArray<readonly [DiagramLanguage, string]> = [
  ["plantuml", "PlantUML"],
  ["mermaid", "Mermaid"],
  ["flowchart", "Flowchart"],
  ["graphviz", "Graphviz"],
];

export const diagramTemplates: Record<DiagramLanguage, ReadonlyArray<readonly [string, string]>> = {
  plantuml: [
    ["时序图 (Timing)", '@startuml\nrobust "服务" as Service\n@0\nService is 空闲\n@5\nService is 工作中\n@enduml'],
    ["序列图 (Sequence)", "@startuml\nactor 用户\nparticipant 服务\n用户 -> 服务: 请求\n服务 --> 用户: 响应\n@enduml"],
    ["用例图 (Use Case)", "@startuml\nactor 用户\n用户 --> (登录)\n用户 --> (查看文档)\n@enduml"],
    ["类图 (Class)", "@startuml\nclass 文档 {\n  标题\n  内容\n}\nclass 编辑器\n编辑器 --> 文档\n@enduml"],
    [
      "流程图 (Flow)",
      "@startuml\nstart\n:填写内容;\nif (完成?) then (是)\n  :保存;\nelse (否)\n  :继续编辑;\nendif\nstop\n@enduml",
    ],
    ["活动图 (Activity)", "@startuml\nstart\n:创建文档;\n:编辑正文;\n:保存;\nstop\n@enduml"],
    ["组件图 (Component)", "@startuml\n[编辑器] --> [文档服务]\n[文档服务] --> [存储]\n@enduml"],
    ["状态图 (State)", "@startuml\n[*] --> 草稿\n草稿 --> 已发布\n已发布 --> [*]\n@enduml"],
    ["对象图 (Object)", "@startuml\nobject 文档 {\n  title = 示例\n}\nobject 编辑器\n编辑器 --> 文档\n@enduml"],
  ],
  mermaid: [
    ["Flow Chart", "flowchart TD\n  A[开始] --> B{完成?}\n  B -->|是| C[保存]\n  B -->|否| D[继续编辑]"],
    ["Sequence Diagram", "sequenceDiagram\n  用户->>编辑器: 输入内容\n  编辑器-->>用户: 显示结果"],
    [
      "Class Diagram",
      "classDiagram\n  class Document {\n    +String title\n    +String content\n  }\n  class Editor\n  Editor --> Document",
    ],
    ["State Diagram", "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Published\n  Published --> [*]"],
    ["ER Diagram", "erDiagram\n  USER ||--o{ DOCUMENT : owns\n  DOCUMENT {\n    string title\n    string content\n  }"],
    ["Gantt", "gantt\n  title 项目计划\n  dateFormat YYYY-MM-DD\n  section 工作\n  编辑 :2026-01-01, 3d\n  完成 :1d"],
    ["Pie Chart", 'pie title 时间分配\n  "编辑" : 60\n  "整理" : 25\n  "复查" : 15'],
  ],
  flowchart: [["Flowchart", "start=>start: 开始\nedit=>operation: 编辑内容\nend=>end: 完成\nstart->edit->end"]],
  graphviz: [
    [
      "Finite State Machine",
      'digraph G {\n  rankdir=LR;\n  draft [label="草稿"];\n  published [label="已发布", shape=doublecircle];\n  draft -> published [label="发布"];\n}',
    ],
  ],
};

export function diagramLanguage(value: unknown): DiagramLanguage {
  return diagramLanguages.some(([language]) => language === value) ? (value as DiagramLanguage) : "plantuml";
}

export function diagramHeight(value: unknown): number {
  if (value === null || value === undefined || value === "") return 300;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(160, Math.min(1000, Math.round(numeric))) : 300;
}
