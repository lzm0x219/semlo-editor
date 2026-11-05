import { withBase } from "@rspress/core/runtime";
import { useRef, useState, type MouseEvent } from "react";

import FrameworkPreview from "./FrameworkPreview";
import HeroAtmosphere from "./HeroAtmosphere";
import { GrowingFeatures, HeroSprig } from "./HomeGrowth";
import { ContentShowcase, DataOwnership, HomeQuestions } from "./HomeHighlights";
import LiveEditor, { type HomeExample, type LiveEditorHandle } from "./LiveEditor";

import "./home.css";
import "./home-motion.css";

const routes = {
  start: "/getting-started",
  frameworks: "/frameworks",
  content: "/content-and-integrations",
  api: "/api",
  features: "/features",
};

function focusEditor(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const editor = document.querySelector<HTMLElement>('#semlo-editor-demo [contenteditable="true"]');
  if (!editor) return;
  event.preventDefault();
  editor.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    if (document.activeElement === editor) {
      document.getElementById("semlo-editor-demo")?.scrollIntoView({ behavior: "instant", block: "start" });
    }
  });
}

function focusOverview(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const heading = document.getElementById("semlo-editor-overview-heading");
  if (!heading) return;
  event.preventDefault();
  heading.scrollIntoView({ behavior: "instant", block: "start" });
  heading.focus({ preventScroll: true });
}

export default function Home() {
  const editor = useRef<LiveEditorHandle>(null);
  const [returnPoint, setReturnPoint] = useState<{ button: HTMLButtonElement; scrollY: number } | null>(null);

  function tryFeature(id: HomeExample, event: MouseEvent<HTMLButtonElement>) {
    setReturnPoint({ button: event.currentTarget, scrollY: window.scrollY });
    editor.current?.openExample(id);
  }

  function returnToFeature() {
    if (!returnPoint) return;
    window.scrollTo({ top: returnPoint.scrollY, behavior: "instant" });
    if (returnPoint.button.isConnected) returnPoint.button.focus({ preventScroll: true });
    setReturnPoint(null);
  }

  return (
    <main className="semlo-editor-home">
      <section className="semlo-editor-hero" aria-labelledby="semlo-editor-heading">
        <div className="semlo-editor-hero-inner">
          <HeroSprig />
          <div className="semlo-editor-hero-copy">
            <div className="semlo-editor-hero-label">
              <span /> Web 富文本编辑器
            </div>
            <h1 id="semlo-editor-heading" tabIndex={-1}>
              让想法
              <br />
              <span>落成篇章。</span>
            </h1>
            <p className="semlo-editor-intro">
              面向 Web 应用的富文本编辑器，
              <br />
              无框架核心，支持多种框架接入。
            </p>
            <p className="semlo-editor-hero-capabilities">Vue / React / SolidJS / JavaScript</p>
            <div className="semlo-editor-actions">
              <a className="semlo-editor-action-primary" href={withBase(routes.start)}>
                开始接入 <span aria-hidden="true">↗</span>
              </a>
              <a className="semlo-editor-action-try" href="#semlo-editor-demo" onClick={focusEditor}>
                试用编辑器 <span aria-hidden="true">↘</span>
              </a>
              <a className="semlo-editor-action-secondary" href={withBase(routes.features)}>
                了解编辑能力 <span aria-hidden="true">→</span>
              </a>
            </div>
            <p className="semlo-editor-project-status">项目开发中 · 组件包暂未发布，接入前需本地构建。</p>
            <div className="semlo-editor-hero-foot">
              <span className="semlo-editor-hero-wordmark">
                semlo-editor<span>.</span>
              </span>
            </div>
          </div>
          <div className="semlo-editor-editor-stage" id="semlo-editor-demo">
            <div className="semlo-editor-stage-label">
              <span className="semlo-editor-stage-desktop-label">一张可以动笔的纸</span>
              <span className="semlo-editor-stage-mobile-label">纸内可上下滚动</span>
              {returnPoint ? (
                <button
                  className="semlo-editor-stage-action semlo-editor-stage-return"
                  type="button"
                  onClick={returnToFeature}
                >
                  返回能力介绍 <span aria-hidden="true">↓</span>
                </button>
              ) : (
                <>
                  <a
                    className="semlo-editor-stage-action semlo-editor-stage-try"
                    href="#semlo-editor-demo"
                    onClick={focusEditor}
                  >
                    试着写写看 <span aria-hidden="true">↘</span>
                  </a>
                  <a
                    className="semlo-editor-stage-action semlo-editor-stage-next"
                    href="#semlo-editor-overview-heading"
                    onClick={focusOverview}
                  >
                    继续浏览 <span aria-hidden="true">↓</span>
                  </a>
                </>
              )}
            </div>
            <LiveEditor ref={editor} />
            <div className="semlo-editor-stage-bottom">
              <span>YOUR SPACE TO THINK</span>
              <span>文字 · 思考 · 表达</span>
            </div>
          </div>
        </div>
        <HeroAtmosphere />
      </section>

      <section className="semlo-editor-overview" aria-labelledby="semlo-editor-overview-heading">
        <div className="semlo-editor-section-intro">
          <p>体验与接入</p>
          <h2 id="semlo-editor-overview-heading" tabIndex={-1}>
            <span className="semlo-editor-overview-label">想法不必一次成形。</span>
            <br />
            先写下来，<span className="semlo-editor-heading-phrase">再慢慢展开。</span>
          </h2>
          <span>
            从表格、公式或分栏开始试用，
            <br />
            或了解如何接入应用。
          </span>
        </div>
        <GrowingFeatures>
          <article>
            <div className="semlo-editor-feature-art semlo-editor-art-type" aria-hidden="true">
              <span>写</span>
              <i>α</i>
            </div>
            <h3>自在书写</h3>
            <p>标题、列表、表格、代码块和公式，让不同内容各得其所。</p>
            <div className="semlo-editor-feature-details">标题 · 待办 · 表格 · 公式</div>
            <div className="semlo-editor-feature-actions">
              <button type="button" onClick={(event) => tryFeature("lists", event)}>
                试试表格 <span aria-hidden="true">↑</span>
              </button>
              <button type="button" onClick={(event) => tryFeature("formula", event)}>
                试试公式 <span aria-hidden="true">↑</span>
              </button>
            </div>
          </article>
          <article>
            <div className="semlo-editor-feature-art semlo-editor-art-blocks" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <h3>有序组织</h3>
            <p>用分栏、大纲、折叠和块操作整理内容，随时调整结构。</p>
            <div className="semlo-editor-feature-details">分栏 · 大纲 · 折叠 · 块操作</div>
            <div className="semlo-editor-feature-actions">
              <button type="button" onClick={(event) => tryFeature("blocks", event)}>
                试试分栏 <span aria-hidden="true">↑</span>
              </button>
            </div>
          </article>
          <article>
            <div className="semlo-editor-feature-art semlo-editor-art-data" aria-hidden="true">
              <span>{"{ }"}</span>
              <i>
                JSON
                <br />
                HTML
              </i>
            </div>
            <h3>灵活接入</h3>
            <p>支持 JSON 和 HTML，上传与提及搜索由你的应用提供。</p>
            <div className="semlo-editor-feature-details">JSON · HTML · 集成回调</div>
            <div className="semlo-editor-feature-actions">
              <a href={withBase(routes.content)}>
                阅读接入说明 <span aria-hidden="true">↗</span>
              </a>
            </div>
          </article>
        </GrowingFeatures>
      </section>

      <ContentShowcase />

      <DataOwnership />

      <section className="semlo-editor-paths" aria-labelledby="semlo-editor-paths-heading">
        <div className="semlo-editor-paths-intro">
          <p>开始使用</p>
          <h2 id="semlo-editor-paths-heading">
            把 semlo-editor
            <br />
            带进你的应用。
          </h2>
          <span>选择熟悉的框架，或直接使用原生 JavaScript API。当前组件包尚未发布，需先在本地构建。</span>
          <a href={withBase(routes.start)}>
            阅读接入指南 <span aria-hidden="true">↗</span>
          </a>
        </div>
        <FrameworkPreview />
        <div className="semlo-editor-path-list">
          <a href={withBase(routes.frameworks)}>
            <span>
              <strong>框架适配</strong>
              <small>选择你的开发方式</small>
            </span>
            <span aria-hidden="true">↗</span>
          </a>
          <a href={withBase(routes.content)}>
            <span>
              <strong>内容与集成</strong>
              <small>保存内容，接入上传和提及搜索</small>
            </span>
            <span aria-hidden="true">↗</span>
          </a>
          <a href={withBase(routes.api)}>
            <span>
              <strong>API 参考</strong>
              <small>配置、类型与控制器方法</small>
            </span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
      <HomeQuestions />

      <footer className="semlo-editor-home-footer">
        <span>
          semlo-editor<span>.</span>
        </span>
        <p>为好好写作而做。</p>
        <a href={withBase(routes.start)}>
          阅读文档 <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </main>
  );
}
