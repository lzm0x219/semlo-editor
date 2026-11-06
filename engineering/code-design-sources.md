# 代码设计资料

本文为 [软件设计与代码实现指南](code-design.md) 提供可追溯的参考资料。所列是与本项目相关的作者论文、标准和官方文档，并非该领域的完整书目，也不表示所有建议都经过了针对 Semlo 的实验验证。每条先概述来源本身的观点，再说明可供项目借鉴的场景与边界；项目的实际结构和兼容性约束仍以 [架构文档](architecture.md)、当前源码和相关测试为准。

## 模块、抽象与架构

### 信息隐藏与变化边界

- **来源**：David L. Parnas, [On the Criteria To Be Used in Decomposing Systems into Modules](https://john.cs.olemiss.edu/~hcc/csci555/notes/localcopy/Parnas_Criteria_Decomposing.pdf), 1972；链接为原刊论文副本。
- **原文要点**：文章对比按处理步骤拆分与按信息隐藏拆分：后一种方式把某些设计决策藏在模块内部，使示例中的部分变化局限于相应模块。作者同时讨论了实现和效率方面的权衡。
- **用于项目**：评估模块时，可检查调用方是否需要了解内部表示、缓存或调用顺序，以及修改同一规则要触及多少地方。论文没有规定文件大小、目录层数或一套适用于所有问题的模块划分。

### 端口与适配器

- **来源**：Alistair Cockburn, [Hexagonal Architecture: the original 2005 article](https://alistair.cockburn.us/hexagonal-architecture)。
- **原文要点**：端口描述应用与外部世界的交互，适配器将技术或设备转换到该交互上；这样可以用不同驱动方式或外部实现运行和测试应用。
- **用于项目**：分析上传、存储等宿主能力与框架适配时，可借此明确交互契约和装配责任；是否增加接口取决于实际变化和测试需求。本文讨论的应用边界不意味着必须先把现有编辑器拆成某种完整架构。

## 契约、替换性与类型

### 前置条件、后置条件和不变量

- **来源**：Bertrand Meyer, [Applying “Design by Contract”](https://se.inf.ethz.ch/~meyer/publications/computer/contract.pdf), 1992。
- **原文要点**：契约用前置条件与后置条件描述调用双方的责任；类不变量描述对象在创建后及公开操作结束等可观察状态下应保持的约束。
- **用于项目**：为内容替换、资源登记和销毁等操作说明允许的输入、结果、失败及不变量。文中使用 Eiffel 和面向对象示例；借鉴契约思路并不要求引入该语言、断言框架或在所有内部瞬间都满足同一不变量。

### 行为替换性

- **来源**：Barbara Liskov、Jeannette Wing, [A Behavioral Notion of Subtyping](https://www.cs.columbia.edu/~wing/publications/LiskovWing94.pdf), 1994。
- **原文要点**：子类型与父类型的关系不只看方法签名；依照父类型规格可证明的性质，在实际使用子类型对象时也应成立。
- **用于项目**：比较可替换的宿主实现或适配器时，应检查输入范围、返回语义、错误及副作用等承诺。论文讨论正式的行为子类型；将相同问题用于其他可替换实现，是工程上的类比，不是 TypeScript 编译器能替代的证明。

### 静态表达与运行时边界

- **来源**：TypeScript 官方手册 [Discriminated unions and exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)；TypeScript 官方 [What is type erasure?](https://github.com/microsoft/TypeScript/wiki/FAQ#what-is-type-erasure)。
- **原文要点**：辨识联合可以按共同的字面量字段收窄类型，并通过 `never` 辅助检查分支；类型注解和接口在编译时被移除，不会自动校验运行时值。
- **用于项目**：相互排斥的会话状态可考虑以辨识联合表达；JSON、HTML、上传响应和宿主回调等外部值仍需按实际边界校验。类型定义或断言不能单独证明外部数据安全或符合 schema。

### 公开 API 和版本

- **来源**：[Semantic Versioning 2.0.0](https://semver.org/)。
- **原文要点**：采用 SemVer 的软件需要声明公开 API；版本号表示相对于该 API 的变化，已发布版本不得原地改变。规范将 `0.y.z` 明确视为初始开发阶段，不承诺 API 稳定。
- **用于项目**：记录公开导出及其兼容性有助于判断升级影响。SemVer 本身不说明如何迁移已存储的编辑器内容，也不能替代对旧 JSON/HTML、接入方和构建产物的验证；项目自定的兼容性承诺仍可严于版本规范。

## 编辑器状态与内容一致性

### 状态、事务与历史

- **来源**：ProseMirror 官方指南 [State](https://github.com/ProseMirror/website/blob/master/markdown/guide/state.md) 和 [Introduction](https://github.com/ProseMirror/website/blob/master/markdown/guide/intro.md)。
- **原文要点**：编辑器状态包括文档、选区、待输入的标记及插件状态；事务作用于旧状态产生新状态。示例中的历史插件观察事务并保存逆变换，以支持撤销。
- **用于项目**：涉及内容、选区和撤销的修改，应检查它们在同一变更链中的关系，并验证相应历史行为。事务提供变更机制，并不意味着所有自定义操作自动获得符合产品预期的撤销语义。

### 文档位置的时效

- **来源**：ProseMirror 官方指南 [Transforms and mapping](https://github.com/ProseMirror/website/blob/master/markdown/guide/transform.md)。
- **原文要点**：文档变化后，旧位置可能改变含义或失效；步骤提供位置映射，但映射整个操作也可能因原内容被删除而失败。
- **用于项目**：异步操作、菜单会话或节点视图持有位置时，应根据上下文映射或重新确认目标及文档归属。不能假设旧数字位置在修改或替换文档后仍指向原内容。

### 状态的权威来源

- **来源**：React 官方文档 [A single source of truth for each state](https://react.dev/learn/sharing-state-between-components#a-single-source-of-truth-for-each-state)。
- **原文要点**：共享状态应有明确的拥有者；这并不要求应用的全部状态集中在一个地方。
- **用于项目**：框架适配层、工具栏和编辑器共享事实时，先确定谁拥有文档状态，其他状态如何读取或同步。这是对 React 状态管理原则的跨框架应用，具体规则依然要以 Semlo 的公开契约和实现为准。

### 受控输入与内容替换

- **来源**：React 官方文档 [`<input>`](https://react.dev/reference/react-dom/components/input)；Tiptap 3.x 官方文档 [`setContent`](https://tiptap.dev/docs/editor/api/commands/content/set-content)。
- **原文要点**：React 的受控原生输入需要通过 `onChange` 同步更新其后备值，且不能在生命周期中切换受控和非受控模式。Tiptap 的 `setContent` 替换文档，渲染受 schema 限制，并提供无效内容是否抛错及是否触发更新事件等选项；其 3.x 文档列出的 `emitUpdate` 默认值为 `true`，与 v2 的默认值不同。
- **用于项目**：设计框架接入时，分别说明初始内容、用户编辑回写和外部替换的语义，并检查相同或无效内容、事件、选区和撤销的处理。React 此处描述的是原生输入，不能直接推出富文本编辑器的实现；Tiptap 的选项和默认值也不是 Semlo 的契约。

### 输入法与浏览器事件

- **来源**：W3C [Input Events Level 2](https://www.w3.org/TR/input-events-2/#input-event-order-during-composition)。
- **原文要点**：规范草案描述了输入法组合会话及 `compositionupdate`、`beforeinput` 和 `input` 的关系，也说明支持某项事件类型不等于浏览器实现所有编辑操作。
- **用于项目**：文本输入或选区变更涉及输入法时，应在目标浏览器中验证组合输入、提交和取消等实际行为。该文档目前是工作草案，不应把其事件序列当成所有浏览器的既成实现。

## 异步和资源生命周期

### 旧结果失效

- **来源**：React 官方文档 [Fetching data with Effects](https://react.dev/reference/react/useEffect#fetching-data-with-effects)。
- **原文要点**：请求返回顺序可能不同于发出顺序；示例通过清理时标记旧结果无效，避免过期响应覆盖当前结果。
- **用于项目**：上传、提及搜索或弹层会话应用结果之前，可按操作语义检查当前实例、请求和文档是否仍匹配。React 的示例针对组件 Effect；这里的实例和文档校验是针对编辑器场景的延伸。

### 取消与释放

- **来源**：WHATWG DOM Standard [Aborting ongoing activities](https://dom.spec.whatwg.org/#aborting-ongoing-activities) 和 [EventTarget](https://dom.spec.whatwg.org/#interface-eventtarget)。
- **原文要点**：支持取消的 API 可接收 `AbortSignal`；给事件监听器传入该信号后，信号中止会移除监听器。只有相应 API 或任务实现了对信号的处理，取消才有作用。
- **用于项目**：对由实例拥有的监听器和支持取消的任务，明确注册与销毁责任；对不能取消或可能已经完成的工作，仍需在提交结果时确认有效性。取消不会自动撤销已发生的外部副作用。

## 不可信输入与输出

### 校验和 XSS 防护

- **来源**：OWASP [Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html) 和 [Cross Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)。
- **原文要点**：输入校验应考虑语法和业务语义；XSS 防护需考虑输出上下文。需要保留用户编写的 HTML 时，OWASP 建议使用维护中的 HTML 净化器，并提醒净化后再修改内容可能破坏保护效果。
- **用于项目**：分别审视普通文本、HTML 和 URL 的输入及输出路径；纯文本场景可使用合适的文本节点或 `textContent`，保留 HTML 的场景需按信任边界制定净化策略。内容结构符合 schema 不等于所有输出上下文都安全；也不能凭一处校验宣称整个接入应用安全。

## 测试与证据

### 可观察行为和测试隔离

- **来源**：Playwright 官方 [Best Practices](https://playwright.dev/docs/best-practices#testing-philosophy)。
- **原文要点**：浏览器测试应关注用户可见行为，减少对无关实现细节的依赖；独立的测试状态有助于复现问题并避免互相污染。
- **用于项目**：针对编辑、撤销、键盘和多实例等行为，优先验证实际结果；当事务顺序、资源释放或公开事件本身构成契约时，也应直接验证这些行为。文档的建议不能证明任何单次测试已覆盖所有边界。

### 性质测试

- **来源**：fast-check 官方文档 [What is Property-Based Testing?](https://fast-check.dev/docs/introduction/what-is-property-based-testing/)。
- **原文要点**：性质测试描述输入与输出应满足的关系，以生成的多组输入运行；工具也可缩小失败样例以帮助定位问题。
- **用于项目**：可在格式转换或纯规则具有明确不变量时，考虑用生成数据补充典型案例，例如为已支持的格式定义适当的往返性质。生成测试不能替代正确的性质定义、真实历史内容或浏览器交互验证，也不要求本项目因此新增依赖。

## 性能与可访问性

### 测量与布局

- **来源**：Chrome 团队 [Forced reflow](https://developer.chrome.com/docs/performance/insights/forced-reflow)；Chrome DevTools [Performance panel](https://developer.chrome.com/docs/devtools/performance/overview/)。
- **原文要点**：布局可能影响交互延迟；交替读取布局信息和写入样式可能导致反复同步布局，性能面板可记录和分析运行过程。
- **用于项目**：对大型文档、浮层定位和连续输入，先记录实际交互及耗时，再按证据处理不必要的读写交错或重复计算。DOM 数量和布局复杂度只是影响因素，不能仅凭源码外观断定瓶颈。

### 键盘、焦点与工具栏

- **来源**：W3C [WCAG 2.2](https://www.w3.org/TR/WCAG22/) 的 [2.1.1 Keyboard](https://www.w3.org/TR/WCAG22/#keyboard)、[2.1.2 No Keyboard Trap](https://www.w3.org/TR/WCAG22/#no-keyboard-trap)、[2.4.7 Focus Visible](https://www.w3.org/TR/WCAG22/#focus-visible)；WAI-ARIA APG [Toolbar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)。
- **原文要点**：上述 WCAG 条款分别涉及键盘操作、避免键盘陷阱与可见焦点，其中 2.1.1 对依赖移动路径的操作有例外。APG 对工具栏建议使用一个 Tab 停靠点，并以方向键在控件间移动；它是设计实践指导，不是独立的符合性标准。
- **用于项目**：检查工具栏和弹层的键盘进入、移动、退出及焦点显示，并结合实际控件处理方向键冲突。满足这些条款或套用工具栏模式不等于整个编辑器达到 WCAG 符合性。

### 控件语义与辅助技术

- **来源**：W3C [WCAG 2.2 的 4.1.2 Name, Role, Value](https://www.w3.org/TR/WCAG22/#name-role-value) 及其[解释](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)；WAI-ARIA APG [Toolbar Example](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/examples/toolbar/)。
- **原文要点**：WCAG 4.1.2 要求界面控件的名称和角色可由程序确定，用户可设置的状态、属性和值可由程序设置，变化通知可供包括辅助技术在内的用户代理使用。APG 的工具栏示例用 `aria-pressed` 表达加粗等切换按钮的状态，用单选组表达互斥的对齐方式；示例还让部分禁用按钮保持可聚焦，便于屏幕阅读器用户发现它们。
- **用于项目**：根据控件实际行为检查可访问名称、角色、选中或禁用状态是否与界面一致，并验证键盘和辅助技术中的变化。禁用按钮是否保留焦点需结合控件和场景判断；APG 示例是一种实践，不是要求所有禁用控件均可聚焦的规则。

### 编辑中的候选列表

- **来源**：W3C WAI-ARIA APG [Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) 和 [Listbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)。
- **原文要点**：APG 区分 DOM 焦点与选中状态；在其组合框的列表弹出层模式中，DOM 焦点留在组合框，通过 `aria-activedescendant` 向辅助技术传递活动项。该指南也提醒可编辑组合框不要拦截浏览器提供的文本编辑按键；对话框弹出层则采用不同的焦点处理。
- **用于项目**：设计提及、搜索或插入候选时，先确定实际控件及弹层的语义，再验证活动项、选择、关闭、焦点恢复和文本输入。富文本内的候选交互不一定满足组合框模式的前提，不能只添加某个 ARIA 属性就假定行为可访问；还需在目标浏览器和辅助技术中验证。

### 不转移焦点的状态消息

- **来源**：W3C [WCAG 2.2 的 4.1.3 Status Messages](https://www.w3.org/TR/WCAG22/#status-messages) 及其[解释](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)。
- **原文要点**：对符合该条定义的状态消息，要求其角色或属性能由程序确定，使辅助技术可以在不接收焦点时呈现消息。解释文档区分搜索结果列表本身与不改变上下文的“结果数量”之类消息；该条不涵盖所有动态内容。
- **用于项目**：对于界面展示的上传进度、搜索结果数量或错误等状态，按具体情境检查是否属于状态消息，以及用户能否在不打断编辑的情况下获知。选择提示频率和方式时需实际验证，不能把每次内容变化都当作必须播报的消息。

### 自动检测的局限

- **来源**：Playwright 官方 [Accessibility testing](https://playwright.dev/docs/accessibility-testing)。
- **原文要点**：自动化工具能发现部分常见可访问性问题，但很多问题仍需人工评估；文档建议结合自动化、人工评估与包容性用户测试。
- **用于项目**：自动扫描可作为回归的一部分，键盘实际操作、辅助技术体验及具体用户需求仍需相应证据；测试通过不应直接表述为全面无障碍合规。

## 组件库 API 与使用体验

### API 可预测性与文档

- **来源**：[Rust API Guidelines](https://rust-lang.github.io/api-guidelines/) 及其[检查清单](https://rust-lang.github.io/api-guidelines/checklist.html)；TypeScript 官方[声明文件发布指南](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html)。
- **原文要点**：Rust 指南从命名、互操作、文档、可预测性、灵活性和类型安全等方面提供建议；TypeScript 说明声明文件可以随 npm 包发布并通过包元数据指明入口。
- **用于项目**：按接入者任务检查默认值、公开类型、错误、示例和包产物，并在真实消费方验证。Rust 的语法和生态约定不直接转化为 TypeScript 规则；声明文件存在也不证明运行时行为或构建出口正确。

### 命令的可执行性

- **来源**：ProseMirror 官方 [`Command` 类型及说明](https://github.com/ProseMirror/prosemirror-state/blob/master/src/transaction.ts)。
- **原文要点**：ProseMirror 命令接收编辑器状态和可选的事务分发函数；不适用时返回 `false`，适用时返回 `true`，提供分发函数时才执行相应效果。因此可以在不分发事务时查询命令是否适用。
- **用于项目**：如需让工具栏判断命令是否可用，应明确查询是否有副作用、结果基于哪份状态，以及真正执行时如何处理状态变化。ProseMirror 的布尔值及参数语义只属于其命令接口，不代表 Semlo 所有命令都有相同返回契约。

### 编辑事件与订阅

- **来源**：Tiptap 3.x 官方文档 [Events](https://tiptap.dev/docs/editor/api/events)。
- **原文要点**：文档分别定义内容变化的 `update`、选区变化的 `selectionUpdate` 和编辑器状态变化的 `transaction` 等事件，并展示通过 `.on()` 订阅和 `.off()` 解除订阅。
- **用于项目**：设计或评审回调时，说明事件观察的对象、触发条件、订阅与清理责任，并结合实际实现确认顺序、重入和异常处理。这些事件的名称和触发条件不能直接视为 Semlo 的公开承诺；列出事件也不足以证明其全部时序行为。

### 可组合组件的边界

- **来源**：Radix Primitives 官方文档 [Composition](https://www.radix-ui.com/primitives/docs/guides/composition)。
- **原文要点**：Radix 的 `asChild` 可以将原有行为与自定义 React 组件组合；自定义组件需要传递所接收的 props 和事件处理器，有些组件还需要接收 ref。更换底层元素时，使用者仍需确保元素的功能和可访问性。
- **用于项目**：确有自定义界面需求时，可检查组合边界能否保留事件、焦点、状态和必要的 DOM 引用，并明确宿主与库各自负责的行为。Radix 的 React 组件机制是一个实例，不要求 Semlo 采用 `asChild`、暴露内部 DOM 或在所有框架提供相同接口形状。

### 可用性启发式与实际研究

- **来源**：Nielsen Norman Group，[10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/)。
- **原文要点**：启发式涉及状态反馈、用户控制、一致性、预防错误、识别优于记忆和错误恢复等可用性视角。
- **用于项目**：以实际编辑任务检查工具栏、输入反馈、撤销和错误恢复；原则之间存在取舍，启发式评审发现的是潜在问题，不能替代目标用户任务测试。

### 模态交互与焦点

- **来源**：W3C WAI-ARIA APG，[Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) 和 [APG Introduction](https://www.w3.org/WAI/ARIA/apg/about/introduction/)。
- **原文要点**：模态对话框实践涉及打开时的焦点、内部键盘导航、关闭及适当的焦点恢复；APG 提供实践指南，并无自身独立的规范符合性模型。
- **用于项目**：实际采用模态对话框时验证相应行为；非模态菜单或弹层需要按其自身模式设计。APG 示例不是所有项目的直接实现，也不能单独证明 WCAG 符合性。
