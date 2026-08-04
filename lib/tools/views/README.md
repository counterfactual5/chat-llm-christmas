# 专项视图（Tool Views）

专项视图是工具结果的**结构化侧栏展示**，与普通文件预览、完整 Office 编辑器都不是一回事。

| 概念 | 做什么 | 不做什么 |
|------|--------|----------|
| **专项视图** | 工具通过 SSE `view_created` 写入 `Message.views`，按 `viewType` 用注册表渲染（如 `docx.extract`） | 不当作可下载文件；不扩展 `canPreviewGeneratedFile` |
| **文件预览** | Output / 对话里的生成文件（md/pdf/图等）用 `ChatPreviewPanel` | 不把 docx/xlsx 当成通用可预览 MIME |
| **完整 Office** | — | 本仓库不做在线 Word/Excel |

## 数据流

1. 工具 `execute` 返回给模型的 JSON（`content`）与 UI 事件分离。
2. UI 事件：`ctx.send({ view_created: ToolViewPayload })`。
3. 客户端 SSE（`lib/chat/stream/client.ts`）调用 `withAppendedAssistantToolView`，写入 `views` + activity `kind: 'view'`。
4. 侧栏 / 消息卡片通过 `lib/tools/views/registry.tsx` 按 `viewType` 渲染。

## 注册新 viewType

在 `registry.tsx` 增加映射，并（可选）在 `types.ts` 声明 `data` 形状。
