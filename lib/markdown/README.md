# Markdown 处理层

这里存放不依赖 React UI 的 Markdown 预处理和解析辅助逻辑。

| Path | Responsibility |
|------|----------------|
| `core/` | 通用 Markdown 处理：流式软换行、整篇文档代码围栏兼容。 |
| `math/` | 数学公式识别、规范化、流式截断保护和 KaTeX 辅助。 |

## 导入约定

- 通用 Markdown 逻辑从 `@/lib/markdown/core/...` 导入。
- 数学相关逻辑优先从 `@/lib/markdown/math` 公共入口导入。
- 需要 React、主题、浏览器 DOM 或 Mermaid 的渲染组件不放在这里，而放在 `components/markdown/`。
