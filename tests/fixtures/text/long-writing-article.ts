export const longWritingCode = "const reviewCount = 2;\nconsole.log(reviewCount);";

const sections = Array.from(
  { length: 9 },
  (_, index) =>
    `<h2>第${index + 1}节 项目交接</h2><p>本节记录工作背景、预计交付、待核验事项和后续安排。写作过程中保留其他章节的文字和顺序，核对关键项后再继续编辑。复查交接资料时，可以从大纲回到本节并补充材料。</p>`,
).join("");

export const longWritingArticle =
  "<h2>交接记录</h2><p>开篇正文，供混合内容保存验收。</p>" +
  sections +
  "<h3>执行明细</h3><ol><li>校对引文</li><li>整理附表</li></ol>" +
  "<table><tr><td>材料</td><td>状态</td></tr><tr><td>编号清单</td><td>待核对</td></tr></table>" +
  `<pre><code>${longWritingCode}</code></pre><p>收尾说明</p>`;
