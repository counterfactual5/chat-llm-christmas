# 专项视图（Tool Views）

专项视图是工具结果的**结构化侧栏展示**，与普通文件预览、完整 Office 编辑器都不是一回事。

| 概念 | 做什么 | 不做什么 |
|------|--------|----------|
| **专项视图** | 工具通过 SSE `view_created` 写入 `Message.views`，按 `viewType` 用注册表渲染 | 不当作可下载文件；不扩展 `canPreviewGeneratedFile` 去认 docx/xlsx |
| **文件预览** | Output / 对话里的生成文件（md/pdf/epub/csv 表等）用 `ChatPreviewPanel` | 不把 docx/xlsx 二进制当成通用可预览 MIME |
| **完整 Office** | — | 本仓库不做在线 Word/Excel |

## 数据流

1. 工具 `execute` 返回给模型的 JSON（`content`）与 UI 事件分离。
2. UI 事件：`ctx.send({ view_created: ToolViewPayload })`。
3. 客户端 SSE（`lib/chat/stream/client.ts`）调用 `withAppendedAssistantToolView`，写入 `views` + activity `kind: 'view'`。
4. 侧栏 / 消息卡片通过 `lib/tools/views/registry.tsx` 按 `viewType` 渲染。

## 生产者 ↔ viewType

| 工具 | 参数 | viewType | `data` |
|------|------|----------|--------|
| `docx_extract` | `file_id`, `mode=extract`（默认） | `docx.extract` | `{ sections: [{ title?, markdown }] }` |
| `docx_extract` | `mode=outline` | `docx.outline` | `{ headings: [{ level, text }] }` |
| `docx_extract` | `mode=comments` | `docx.comments` | `{ comments: [{ id?, author?, body, date? }] }`；`empty` 时仍 `ok:true` |
| `xlsx_extract` | `file_id`, 可选 `sheet` | `xlsx.table` | `{ sheetName?, headers?, rows, sheetNames?, tables? }`；错误 sheet → `ok:false` + `sheet_names` |

无附件的会话会从可用工具中剥离 `file_read` / `docx_extract` / `xlsx_extract`。创建视图后客户端会自动打开侧栏专项视图。

专项视图 ≠ 文件预览 ≠ 完整 Office。

## 注册新 viewType

在 `registry.tsx` 增加映射，并（可选）在 `types.ts` 声明 `data` 形状；再补一个工具（或扩展现有工具）发 `view_created`。
