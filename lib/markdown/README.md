# Markdown

## `lib/markdown/` — 预处理（无 React）

不依赖 React UI 的 Markdown 预处理和解析辅助逻辑。

| Path | Responsibility |
|------|----------------|
| `core/` | 通用 Markdown 处理：`document-fence.ts`（整篇文档代码围栏解包）。`breaks.tsx` 是消息 UI 用的 React `<br>` 展开——对本目录「无 React」约定的例外（理想归属是 `components/markdown/`）。 |
| `math/` | 数学公式：规范化、检测、流式截断保护、强调/`$` 修复、`prepareChatMarkdown`、KaTeX DOM 辅助。公共入口 `@/lib/markdown/math`（`index.ts` barrel）。 |

### 导入约定

- 通用 Markdown 逻辑从 `@/lib/markdown/core/...` 导入。
- 数学相关逻辑优先从 `@/lib/markdown/math` 公共入口导入。
- 需要 React、主题、浏览器 DOM 或 Mermaid 的渲染组件放在 `components/markdown/`，不要把浏览器依赖放回本目录（`core/breaks.tsx` 除外，见上表）。

## `components/markdown/` — 渲染（React）

依赖 React 和浏览器环境的视觉渲染组件。

| Path | Responsibility |
|------|----------------|
| `code/` | 代码块渲染、复制和语法高亮；识别 `mermaid` 后转交图表组件。 |
| `diagrams/` | Mermaid 图表渲染、主题适配、源码回退和复制。 |

```text
ReactMarkdown
  └── code/code-block.tsx
        ├── 普通语言 → highlight.js
        └── mermaid → diagrams/mermaid-block.tsx
```
