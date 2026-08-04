# Markdown

预处理与渲染的拆分、以及「只走 `AnswerMarkdown`」等约定，服从仓库总规范：[`docs/code-organization.md`](../../docs/code-organization.md)。

## `lib/markdown/` — 预处理（无 React）

不依赖 React UI 的 Markdown 预处理和解析辅助逻辑。

| Path | Responsibility |
|------|----------------|
| `core/` | 通用 Markdown 处理：`document-fence.ts`（整篇文档代码围栏解包）、`ascii-art.ts`（Unicode/ASCII 树与框图恢复）、`mermaid.ts`（单反引号或无语言围栏 Mermaid 提升）、`blocks.ts`（整段换行被压扁后恢复标题/列表/分隔线，并调用 `tables.ts`）、`tables.ts`（被压成一行的 GFM 表格行恢复）。`breaks.tsx` 是消息 UI 用的 React `<br>` 展开——对本目录「无 React」约定的例外（理想归属是 `components/markdown/`）。 |
| `math/` | 数学公式：规范化、检测、流式截断保护、强调/`$` 修复、`**https://…**` 加粗链接与 GFM autolink 冲突修复、`prepareChatMarkdown`、KaTeX DOM 辅助。公共入口 `@/lib/markdown/math`（`index.ts` barrel）。 |

### 导入约定

- 通用 Markdown 逻辑从 `@/lib/markdown/core/...` 导入。
- 数学相关逻辑优先从 `@/lib/markdown/math` 公共入口导入。
- 需要 React、主题、浏览器 DOM 或 Mermaid 的渲染组件放在 `components/markdown/`，不要把浏览器依赖放回本目录（`core/breaks.tsx` 除外，见上表）。

## `components/markdown/` — 渲染（React）

依赖 React 和浏览器环境的视觉渲染组件。

| Path | Responsibility |
|------|----------------|
| `code/` | 代码块渲染、复制和语法高亮；识别 `mermaid` 后转交图表组件；ASCII/Unicode 框图走 `ascii-art-pre`（按东亚终端 1/2 栏宽铺格子，避免 Menlo CJK ≈1.66× 错位）。 |
| `diagrams/` | Mermaid 图表渲染、主题适配、源码回退和复制。 |

聊天内 Markdown 渲染统一走 `components/chat/message/AnswerMarkdown.tsx`（含 ASCII 重排 / 表格恢复等预处理），避免平行再起一套 `react-markdown`：

- 助手答案、Thought / CoT（`reflowBlocks={false}`，避免把思考里的半成品表格「修好」）
- 用户引用块、composer 引用预览、`image_understand` 等片段
- Output / File Manager 的 `.md` / `.txt` / `text/plain` 预览

其它源码扩展名预览仍用 `CodeBlock`。新 UI 需要渲染聊天气泡同款 Markdown 时，复用 `AnswerMarkdown`，不要直接挂 `react-markdown`。

```text
ReactMarkdown
  └── code/code-block.tsx
        ├── 普通语言 → highlight.js
        └── mermaid → diagrams/mermaid-block.tsx
```
