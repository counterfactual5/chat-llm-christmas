# URL Preview：图片占位 + 图片理解 实施计划

**日期:** 2026-08-08
**状态:** Ready to start implementation
**范围:** `chat-llm-christmas`（前端 + 图片理解 API 代理）；`chat-api` **零改动**
**上一篇:** [2026-08-08-002-feat-web-extract-adaptive-length-clean-links-plan.md](2026-08-08-002-feat-web-extract-adaptive-length-clean-links-plan.md)

---

## 1. 问题 / 用户请求

URL 预览面板的正文里，`![alt](src)` 图片语法在渲染时表现不好：

1. **图片断了线** — 抽取链（Fetch MCP readability 抽取 + clean 过滤）会把它们当成无用链接丢弃（特别是 `about:` 引文链和 CC 标记），或被 `hideBrokenImage` 静默藏。
2. **完全看不到图** — 即便图片 URL 好（`https://`），面板目前不做任何特殊处理，用户看不到原图。
3. **无"读图"能力** — 面板没有调用 Image Understand 来生成文字描述的入口，用户只能开新标签看原图。

**目标：** 让面板在 markdown 中渲染图片时：

- **A. 首先** 直接以 `<img>` 显示远程图（`https://`），用户不点任何按钮就能看到图。
- **B. 直接失败 / 图片不是 http**（relative / data-only / CF-blocked）时显出简洁的"图片占位卡"——含 alt / 尺寸占位 / **"加载图片描述"按钮**。
- **C. 点按钮** → 调 `image_understand`（`understandImage({ imageUrl, userPrompt })`）把 GLM-4.6V 文字描述回填到原位（替换占位卡），用户继续读不快。

**非目标：**

- 不改 Fetch MCP / readability —— **不把**被 clean 掉的徽章/CC 图抢回来（它们本来就是噪声）。
- 不实现"按图上下文理解"（`userPrompt` 带周围段落）—— 本轮固定一段通用指令，下期再加。
- 不动 assistant 气泡 markdown —— AnswerMarkdown 的 `hideBrokenImage` 逻辑保持现状，只被 UrlPreviewPanel 引用。
- 不做 SSRF 白名单 —— 图片 URL 只用用户面板上已读到的，不再反向抓任何服务器资源。

---

## 2. 调研纪要

### 2.1 图片在哪一层丢的 / 留下的

| 层 | 行为 | 结果 |
|---|---|---|
| `readability` / MCP 抓取 | 保留正文 `<img>` 转为 `![alt](src)` | `https://` 图保留 ✅；relative→绝对化；`about:` 引文链留下 |
| `cleanWebReadContent` (server) | `isBadImageLine` 过滤 `about:` / `#` / `javascript:` / 徽章 | 只有**能渲染的 http(s) 图** 就没被清；徽章被清（这是想要的）|
| `AnswerMarkdown` (render) | 默认 `hideBrokenImage` → 断图静默不显示 | 用户根本不知道有图 |

→ 结论：**能显示的图本来就在**，只是 `hideBrokenImage` 把断的也藏了。我们要做的不是把被 clean 掉的救回来，而是**换 `hideBrokenImage` 为占位卡 + 理解按钮**。

### 2.2 Image Understand 调用路径

- `lib/tools/image-understand/vision.ts` — `understandImage({ imageUrl, userPrompt }, gateway)` 已支持 **`http(s)` URL 直接传**（`resolveImageUrlForVision`:117 行 `if (/^https?:\/\//i.test(raw)) return raw;`），不必先上传到 gateway。
- `gateway` 参数 = `{ apiKey, baseURL }`，其中 `apiKey` 是 HttpOnly cookie `llm_chat_api_key`，`baseURL` = `filesGatewayBaseURL()`（chat-api）。
- 现有调用方（`rewriteMessagesWithImageDescriptions`）是**服务端**（chat completion 前转写上传图片）——面板不能复用这条路径，因为面板需要的是"对某个 URL 单独调一次"。
- → 需新增 **`app/api/image-understand/route.ts`**：Edge、`auth via llm_chat_api_key` cookie、`understandImage({ imageUrl }, { apiKey, baseURL })`，返回 `{ ok, text, mode, provider }`。

### 2.3 面板渲染器准备

`AnswerMarkdown.tsx` 已 `const markdownComponents = { img({ src, alt }) { ... } }` —— 目前是：

- `!src` → `null`
- 相对路径 → 拨给 `resolvePreviewHttpUrl` 拼面板 base URL
- 合法的 → `<img onError={hideBrokenImage} …>`
- 断图 → `display:none` （彻底看不到）

计划是只在这个 `img` 渲染器里分类，不动其他组件。

### 2.4 现有 loadingMore / 分块

面板上一轮已支持分块 Load more。图片图出现频率按块递增 — 每张图独立状态即可，**不引入**全局图队列。

---

## 3. 架构方案

```
UrlPreviewPanel.tsx (已有)
  └─ AnswerMarkdown (已有)
       └─ img renderer  ← 改这里
            ├─ https://  → <PreviewImage> 组件
            │               ├─ loading 显示占位卡 skeleton
            │               ├─ load 成功 → <img>
            │               └─ error → Placeholder card (alt + [加载图片描述])
            │                     ↓ click
            │                     POST /api/image-understand
            │                     ← { ok, text }
            │                     → 显示描述文本 (替换占位卡)
            └─ 非 http → 直接 Placeholder card （同按钮）

app/api/image-understand/route.ts (新增)
  ├─ Edge runtime (与 web-read 代理一致)
  ├─ 验 llm_chat_api_key cookie → 401
  ├─ POST { imageUrl }
  ├─ 调 understandImage({ imageUrl, userPrompt: DEFAULT_PROMPT }, { apiKey, baseURL })
  ├─ 24s AbortController 内部超时 (vision.ts 45s 太宽，Edge maxDuration 60s)
  └─ → { ok, text, mode, provider } | { ok: false, error }
```

**为什么选择 Edge route 而不是 client-side：** `llm_chat_api_key` 是 HttpOnly cookie，前端 JS 读不到；所有 chat-api 调用必须走 Next API 代理代附上 Bearer。这与 `web-read` / `upload-token` 一致。

---

## 4. 分步任务 (TodoWrite)

### T1 — `lib/files/url-preview-image.ts`（新，客户端纯函数）
图片 URL 分类 + 状态机。
- `classifyPreviewImageSrc(src, baseUrl?)`：
  - 空 / `data:` / `blob:` → `{ kind: 'skip' }`
  - `http(s)://` → `{ kind: 'remote', src }`
  - 相对 → 拼 baseUrl，若 `resolvePreviewHttpUrl` 成功 → `{ kind: 'remote', src: absolute }`，否则 `{ kind: 'skip' }`
- `IMAGE_PLACEHOLDER_ALT_MAX = 80`（alt 显示截断）

### T2 — `components/chat/panels/UrlPreviewImage.tsx`（新）
单图渲染组件，4 态：
- `loading` — 占位卡：`[图标] 加载中…`
- `loaded` — `<img src>` 充满宽度（高度 auto，max-h 240px）
- `error` / `skipped` — 占位卡：`[图标] <alt 截断>` + `加载图片描述` 按钮
- `describing`（点击后）— 按钮变 spinner + 文案；返回后 `described` 替换占位为描述文本（最多 400 字，`…` 截断）
状态放 `useState`；失败保留占位卡（允许重试按钮）。

### T3 — `app/api/image-understand/route.ts`（新）
Edge POST handler：
- 401 if no cookie
- 400 if `!imageUrl` 或 `!/^https?:\/\//`
- `understandImage({ imageUrl, userPrompt: URL_PREVIEW_IMAGE_PROMPT }, { apiKey, baseURL })`
- `Promise.race` 24s timeout → 504
- 成功 `{ ok: true, text, mode, provider }` / 失败 `{ ok: false, error }` (502)

`URL_PREVIEW_IMAGE_PROMPT`：
> "描述这张图片的内容。如果它是论文插图、图表或截图，请重点提取其中的文字、数据标签、坐标轴和结论，不要只描述外观。"

### T4 — `AnswerMarkdown.tsx`（一处修改）
`img` renderer 从"直接 `<img onError=hideBroken>`"改为：

```ts
img({ src, alt }: any) {
  if (ctx.previewBaseUrl /* in panel */) {
    return <UrlPreviewImage src={src} alt={alt} baseUrl={ctx.previewBaseUrl} />;
  }
  // 非面板上下文（如 assistant 气泡）保持旧行为
  return <img src={src} alt={alt} onError={(e) => hideBrokenImage(e.currentTarget)} />;
}
```

⚠️ 调研：`previewBaseUrl` 现在只在面板打开链接预览时设置；需要验证是否在 UrlPreviewPanel 的 AnswerMarkdown 挂载中传入。若没传，需要补一个 context prop 或新增 `imageVariant: 'preview' | 'chat'` 显式区分。

### T5 — i18n
`lib/i18n/messages.ts`：
- `urlPreviewImageLoading`: '图片加载中…' / 'Loading image…'
- `urlPreviewImageAlt`: '图片' / 'Image'
- `urlPreviewImageUnderstand`: '加载图片描述' / 'Describe image'
- `urlPreviewImageUnderstanding`: '理解中…' / 'Understanding…'
- `urlPreviewImageFailed`: '加载失败' / 'Load failed'

### T6 — 单元测试
- `tests/chat/url-preview-image.test.ts` — `classifyPreviewImageSrc` 边界（http/https/relative/data/blob/坏 URL/拼 base）
- `tests/chat/url-preview-image-component.test.tsx` — Placeholder → click → mock fetch → described 状态迁移

### T7 — 手测 + commit
- 面板打开 [nature 论文](https://www.nature.com/articles/s41586-025-08892-5)
- 看 https:// 图直接渲染 / 断图变成占位卡
- 点"加载图片描述" → 3-8 秒返回 GLM-4.6V 描述
- `git push origin <current-branch>`（在 worktree 分支上）

---

## 5. 风险 & 兜底

| 风险 | 缓解 |
|---|---|
| 图很多（论文 40+ 张）→ 占位卡占屏 | `max-h-40`、占位卡高度紧凑 |
| 用户连点 N 张图 → vision 限流 | 每张图独立 API 请求；失败显示重试按钮 |
| CF / 微信图片反盗链 → 直接 `<img>` 失败 | 自动落到占位卡 + 理解按钮（`imageUrl` 走 vision 后端 fetch 不受 CF 影响）|
| `previewBaseUrl` context 现在可能没传到 AnswerMarkdown | T4 明确验证；必要时改为显式 prop |
| vision 45s timeout vs route 24s timeout | route timeout < 后端 timeout，保证 504 先到，不让请求悬挂 |

---

## 6. 明确不做

- ❌ 抢回被 clean 的徽章 / CC / `about:` 图（它们本来就是噪声）
- ❌ 面板内图片懒加载 beyond 浏览器原生 `loading="lazy"`
- ❌ 图片描述的本地缓存（每张每次点都重新调 vision；下期按需加）
- ❌ 把 Image Understand 暴露为 model-callable tool（本期纯用户手动触发）
- ❌ 改 `AnswerMarkdown` 里非 `img` 的任何 renderer
- ❌ chat-api 改动（0 行）

---

*Ready for Phase 5.4 handoff —  sep 选 1 开工。*
