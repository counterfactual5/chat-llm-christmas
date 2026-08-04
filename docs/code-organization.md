# 代码组织与模块规范

本文是仓库的**结构约定**：按功能域拆分、可复用逻辑提前抽出、UI / hooks / lib / API 分层。写新功能前先对一下这里，避免事后大挪文件。

领域细节仍看各目录 README（见文末索引）。冲突时：**本文的拆分原则 > 就近堆在已有大文件里**。

---

## 1. 总原则

1. **按功能模块组织，不按「文件长短」或「随便找个近的文件塞」**  
   同一产品能力（会话、附件、斜杠命令、审查、Markdown…）应有清晰归属目录；跨域复用的能力抽到独立 `lib/<domain>/`，不要复制粘贴。

2. **可复用的、边界清楚的能力要拆开**  
   满足任一条就应独立成模块（文件或子目录），而不是内联在调用方：
   - 将被 ≥2 个调用方使用（或很快会）
   - 有稳定输入/输出，可单测
   - 与调用方 UI / 请求管线无强耦合
   - 是「目录 / 映射 / 解析器 / 下载 / 上传」这类 SSOT 数据或算法

3. **一层只做一层的事**（依赖只能向下）  

   | 层 | 放什么 | 不放什么 |
   |----|--------|----------|
   | `app/api/**/route.ts` | HTTP：`runtime` / `maxDuration` / 鉴权入口 / 调 lib | 业务编排、大段 prompt、工具循环 |
   | `components/**` | 渲染、局部交互、展示态 | 会话持久化、SSE 解析、工具执行、MIME 表 |
   | `hooks/**` | 需要 React 树的状态、effect、编排 | 纯函数算法（下沉 `lib/`） |
   | `lib/**` | 纯逻辑、SSOT、server-only 管线 | JSX（少数文档已标明的例外除外） |

4. **优先扩展归属模块，禁止继续膨胀外壳**  
   `components/chat-container.tsx` 只做接线（UI ↔ hooks）。新逻辑进 owning hook / `lib/chat/*`，见 [`lib/chat/README.md`](../lib/chat/README.md) 与 container 头注释 ownership 表。

5. **单一事实来源（SSOT）**  
   目录、映射、命令列表、流式标签解析等只维护一份；调用方 import，不另起平行表。已有例子：`lib/files/text-types.ts`、`lib/chat/composer/slash-commands.ts`、`lib/chat/message/stream-xml-tags.ts`、`lib/images/generate-and-store.ts`、`AnswerMarkdown`。

---

## 2. 顶层目录怎么放

```text
app/api/<feature>/     薄 HTTP 入口（按功能分子目录）
components/<feature>/  React UI（按功能分子目录，与 lib 域对齐）
hooks/<feature>/       该功能的 React 编排
lib/<feature>/         可复用逻辑 / SSOT / server 管线
docs/                  产品与跨仓流程说明（非代码地图时用）
```

| 域 | UI | Hooks | Lib | 备注 |
|----|----|-------|-----|------|
| Chat 壳 | `components/chat/*`、`chat-container.tsx` | `hooks/chat/*` | `lib/chat/*` | 地图：`lib/chat/README.md` |
| Markdown 渲染 | `components/markdown/*` + `components/chat/message/AnswerMarkdown.tsx` | — | `lib/markdown/*` | 预处理无 React；渲染在 components |
| 文件 / 预览 | `components/files/*`、chat panels | — | `lib/files/*` | `lib/files/README.md` |
| 生图 | — | — | `lib/images/*` | 工具与 `/api/images` 共用 |
| 工具 | `lib/tools/views`（侧栏视图） | — | `lib/tools/<tool-name>/` | 一工具一目录；审查见 review README |
| 集成 / MCP | `components/integrations/*` | （chat 内 use-integrations） | `lib/integrations/*`、`lib/mcp/*` | OAuth / vault 与 MCP 客户端分开 |
| 记忆 / 技能 / 模型 | `components/memories` 等 | `hooks/chat/use-memor*`、`use-skills` | `lib/memories`、`lib/skills`、`lib/models` | |

**对齐习惯**：新增 chat UI 片段放 `components/chat/<area>/`（`composer` / `message` / `session` / `panels` / `overlays` / `research`），对应纯逻辑放 `lib/chat/<area>/`，不要在 `components/` 根或 `lib/` 根散落同名杂文件。

---

## 3. 拆分检查清单（写代码前）

- [ ] 这段逻辑是否已有 owning 模块？有则扩展，不新开平行实现。
- [ ] 是否纯函数 / 无 React？→ `lib/<domain>/`；是否要 state/effect？→ `hooks/` + 调用 lib。
- [ ] 是否 server-only（密钥、上游流、工具循环）？→ `lib/chat/server/*` 或工具目录；**禁止**经 client barrel 再导出。
- [ ] 是否「目录 / 命令列表 / MIME / 解析器」？→ 独立 SSOT 文件，UI 只消费。
- [ ] 两个表面（如 Composer + Sidebar）是否展示同一组能力？→ 共享 catalog，各自只写点击/插入差异。
- [ ] 新 API route 是否超过「解析 body + 调一个 lib 函数」？→ 把编排挪进 `lib/`。
- [ ] 是否在复制已有 `fetch` / `createElement('a')` / `EXT_*` / `react-markdown` 样板？→ 停，改用现有 helper。

---

## 4. 模块边界细则

### 4.1 Chat

- **Container**：接线；ownership 见 `components/chat-container.tsx` 文件头。
- **`lib/chat/session/mutations`**：会话不可变补丁的唯一入口（`@/lib/chat/session/mutations`）。
- **斜杠**：列表数据 → `lib/chat/composer/slash-commands.ts`；图标 → `components/chat/composer/slash-command-ui.ts`；解析与发送行为 → `lib/chat/turn/*-command.ts` + `hooks/chat/use-slash.ts`。
- **流式标签**：通用 open/close → `stream-xml-tags.ts`；think / fake-tool 各自薄封装。

### 4.2 文件与预览

- 扩展名 / MIME / 高亮语言 → 只改 `text-types.ts`。
- 预览拉字节 → `fetchFileContentForPreview`。
- 下载 → `lib/files/download.ts`（chat 包装可留在 `lib/chat/composer/download.ts`）。

### 4.3 Markdown

- 预处理：`lib/markdown/core`、`lib/markdown/math`。
- 聊天气泡同款渲染：只挂 `AnswerMarkdown`（Thought 用 `reflowBlocks={false}`）。
- Mermaid / CodeBlock：`components/markdown/**`，不要把浏览器依赖塞回 `lib/markdown`（已标明例外除外）。

### 4.4 工具（`lib/tools`）

- **一工具一目录**（`create-file/`、`image-generate/`…），入口经 `lib/tools` 注册表。
- 跨工具共享能力（生图入库、MIME、gateway 上传）放 `lib/images`、`lib/files`，工具目录只做 schema + execute 胶水。
- Claim review、专项视图：见 `lib/tools/review/README.md`、`lib/tools/views/README.md`。

### 4.5 命名与文件粒度

- 目录名 = 功能域（`composer`、`session`、`message`），不用 `utils`、`helpers` 当长期归属（临时抽出后应迁入域内）。
- 单文件职责单一；出现第二种无关职责时拆文件，而不是靠「反正都在 chat 里」。
- 允许薄 re-export（如 `create-file` 再导出 `mimeFromFilename`）方便旧 import，但**权威实现只有一处**。

---

## 5. 明确反模式

| 反模式 | 应改成 |
|--------|--------|
| 在 `chat-container.tsx` 里加业务分支 / 新状态机 | 新 hook 或 `lib/chat/...`，container 只接线 |
| Composer / Sidebar 各维护一份命令按钮 | 共享 `PRODUCT_SLASH_COMMANDS` |
| 各处私有 `EXT_MIME` / 下载 anchor 样板 | `text-types` / `lib/files/download` |
| `/api/images` 与 `generate_image` 两套上传 | `generateAndStoreImage` |
| 新面板再 `import ReactMarkdown` | `AnswerMarkdown` |
| `lib/chat` client barrel 导出 server 模块 | 调用方直连 `@/lib/chat/server/...` |
| 为「兼容」在根目录加只转发的 shim 文件 | 改 import 到真实归属（review 已禁止） |
| 用 system prompt 硬编码掩盖渲染 / 预处理 bug | 修 `lib/markdown` / 组件 |

---

## 6. 领域 README 索引

| 文档 | 内容 |
|------|------|
| [`lib/chat/README.md`](../lib/chat/README.md) | Chat 分层与子目录职责 |
| [`lib/chat/server/README.md`](../lib/chat/server/README.md) | `/api/chat` 管线与工具轮 |
| [`lib/files/README.md`](../lib/files/README.md) | 文件 MIME、预览、下载 SSOT |
| [`lib/images/README.md`](../lib/images/README.md) | 生图 + Files 入库 |
| [`lib/markdown/README.md`](../lib/markdown/README.md) | 预处理 vs 渲染、`AnswerMarkdown` |
| [`lib/tools/review/README.md`](../lib/tools/review/README.md) | Claim review 入口与纠正门槛 |
| [`lib/tools/views/README.md`](../lib/tools/views/README.md) | 工具专项视图 vs 文件预览 |
| [`docs/images-and-files.md`](./images-and-files.md) | 附件上传、视觉、file_read 产品流 |

Agent 入口：[`AGENTS.md`](../AGENTS.md)（先读本文再下钻领域 README）。
