# Markdown 渲染组件

这里存放依赖 React 和浏览器环境的 Markdown 视觉渲染组件。

| Path | Responsibility |
|------|----------------|
| `code/` | 代码块渲染、复制和语法高亮；识别 `mermaid` 后转交图表组件。 |
| `diagrams/` | Mermaid 图表渲染、主题适配、源码回退和复制。 |

## 组件关系

```text
ReactMarkdown
  └── code/code-block.tsx
        ├── 普通语言 → highlight.js
        └── mermaid → diagrams/mermaid-block.tsx
```

纯 Markdown 预处理逻辑位于 `lib/markdown/`，不要把浏览器渲染依赖放回该目录。
