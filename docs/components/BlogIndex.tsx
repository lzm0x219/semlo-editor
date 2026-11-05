import { Head, usePages } from "@rspress/core/runtime";
import { Link } from "@rspress/core/theme";

import "./blog.css";

function postDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) ? value.slice(0, 10) : "";
}

export default function BlogIndex() {
  const { pages } = usePages();
  const posts = pages
    .filter((page) => {
      const path = page.routePath
        .replace(/\.html$/, "")
        .replace(/\/$/, "")
        .replace(/\/index$/, "");
      return path.startsWith("/blog/");
    })
    .sort(
      (a, b) =>
        postDate(b.frontmatter.date).localeCompare(postDate(a.frontmatter.date)) || a.title.localeCompare(b.title),
    );

  return (
    <main className="semlo-editor-blog">
      <Head>
        <title>博客 - semlo-editor</title>
      </Head>
      <div className="semlo-editor-blog__inner">
        <header className="semlo-editor-blog__intro">
          <h1>博客</h1>
          <p>记录 semlo-editor 的开发进展、设计思考与实践。</p>
        </header>
        <section className="semlo-editor-blog__articles" aria-labelledby="semlo-editor-blog-articles">
          <h2 id="semlo-editor-blog-articles">文章</h2>
          {posts.length ? (
            <ul className="semlo-editor-blog__list">
              {posts.map((post) => {
                const date = postDate(post.frontmatter.date);
                return (
                  <li key={post.routePath}>
                    <Link href={post.routePath} className="semlo-editor-blog__post">
                      <span className="semlo-editor-blog__post-content">
                        <strong>{post.title}</strong>
                        {post.description && <span>{post.description}</span>}
                      </span>
                      {date && <time dateTime={date}>{date}</time>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="semlo-editor-blog__empty">
              <p>暂无文章</p>
              <span>新文章发布后会出现在这里。</span>
              <Link href="/documentation">浏览文档</Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
