import { withBase } from "@rspress/core/runtime";

import "./home-highlights.css";

export function ContentShowcase() {
  return (
    <section className="semlo-editor-showcase" aria-labelledby="semlo-editor-showcase-heading">
      <div className="semlo-editor-showcase-intro">
        <p>一份文档的样子</p>
        <h2 id="semlo-editor-showcase-heading">
          每一种内容，
          <br />
          都有合适的<span className="semlo-editor-heading-phrase">表达方式。</span>
        </h2>
        <span>从记录到整理，把文字、重点和进度放在同一篇文档里。</span>
        <a href={withBase("/features")}>
          查看所有编辑能力 <span aria-hidden="true">↗</span>
        </a>
      </div>
      <div className="semlo-editor-showcase-stage">
        <article className="semlo-editor-showcase-paper" aria-label="文档内容示意">
          <div className="semlo-editor-showcase-paper-top">
            <span>一份活动记录</span>
            <span>内容示意</span>
          </div>
          <h3>把一件事慢慢做好</h3>
          <p>从想法到行动，让每一步都清晰可见。</p>
          <div className="semlo-editor-showcase-callout">
            <span aria-hidden="true">✳</span> 先记录，再整理；不必急着一次完成。
          </div>
          <table>
            <thead>
              <tr>
                <th>事项</th>
                <th>进度</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>收集灵感</td>
                <td>
                  <span className="semlo-editor-showcase-status">进行中</span>
                </td>
              </tr>
              <tr>
                <td>整理思路</td>
                <td>待开始</td>
              </tr>
            </tbody>
          </table>
        </article>
        <div className="semlo-editor-showcase-aside">
          <article className="semlo-editor-showcase-note">
            <span>结构与排版</span>
            <strong>
              <span>表格、</span>
              <span>分栏、</span>
              <span>提示块</span>
            </strong>
            <p>让信息有条理，也让重点更容易被看见。</p>
          </article>
          <article className="semlo-editor-showcase-formula">
            <span>公式与代码</span>
            <strong aria-label="E 等于 m c 的平方">
              E = mc<sup>2</sup>
            </strong>
            <p>在同一篇文档里书写公式与代码。</p>
          </article>
        </div>
      </div>
    </section>
  );
}

export function DataOwnership() {
  return (
    <section className="semlo-editor-data" aria-labelledby="semlo-editor-data-heading">
      <div className="semlo-editor-data-inner">
        <div className="semlo-editor-data-intro">
          <p>内容与集成</p>
          <h2 id="semlo-editor-data-heading">
            内容留给应用，
            <br />
            如何使用由你决定。
          </h2>
          <span>通过快照获取内容，在应用中保存、展示或处理。</span>
          <a href={withBase("/content-and-integrations")}>
            了解内容与集成 <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="semlo-editor-data-formats">
          <div className="semlo-editor-data-code">
            <code>
              <span className="semlo-editor-data-keyword">const</span> {"{ json, html, text }"} = editor.
              <span className="semlo-editor-data-function">getSnapshot</span>()
            </code>
          </div>
          <dl>
            <div>
              <dt>JSON</dt>
              <dd>结构化文档，适合保存与恢复编辑。</dd>
            </div>
            <div>
              <dt>HTML</dt>
              <dd>用于导出或在应用中展示内容。</dd>
            </div>
            <div>
              <dt>Text</dt>
              <dd>获取文档的纯文本内容。</dd>
            </div>
          </dl>
          <p>持久化、文件上传和提及搜索需要由接入方提供。</p>
        </div>
      </div>
    </section>
  );
}

export function HomeQuestions() {
  return (
    <section className="semlo-editor-questions" aria-labelledby="semlo-editor-questions-heading">
      <div className="semlo-editor-questions-intro">
        <p>使用前了解</p>
        <h2 id="semlo-editor-questions-heading">一些常见问题。</h2>
        <span>从试用到接入，先看看这些基本约定。</span>
      </div>
      <div className="semlo-editor-questions-list">
        <details>
          <summary>
            <span>现在可以安装 semlo-editor 吗？</span>
          </summary>
          <p>
            组件包仍在开发中，暂未发布。可以先在项目目录构建，再通过本地依赖接入。
            <a href={withBase("/getting-started")}>查看安装步骤</a>
          </p>
        </details>
        <details>
          <summary>
            <span>编辑的内容会自动保存吗？</span>
          </summary>
          <p>
            编辑器不提供持久化服务。应用可以从变更事件或控制器获取 JSON，并自行保存与恢复。
            <a href={withBase("/content-and-integrations#内容保存与恢复")}>了解内容保存</a>
          </p>
        </details>
        <details>
          <summary>
            <span>图片上传和提及搜索如何接入？</span>
          </summary>
          <p>
            通过上传和搜索回调接入应用自己的服务；附件、音频和视频共用附件上传回调。
            <a href={withBase("/content-and-integrations")}>了解集成方式</a>
          </p>
        </details>
        <details>
          <summary>
            <span>是否兼容语雀的文档格式？</span>
          </summary>
          <p>
            项目受语雀编辑体验启发，但目前没有实现 Lake 格式兼容，也不宣称功能完全一致。
            <a href={withBase("/features#当前边界")}>查看当前边界</a>
          </p>
        </details>
      </div>
    </section>
  );
}
