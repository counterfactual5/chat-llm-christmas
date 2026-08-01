# Deep Research + 独立 Chat Backend 落地计划

> 承接 `~/Downloads/HANDOFF.md`，并覆盖「聊天产品与主站解耦」决策。  
> **架构定稿（2026-08-01）：** 独立仓库 **`~/Work/chat-api`**（域名 `api.chat.llm.christmas`）做常驻后端；产品存储从门户迁出；Deep Research 跑在该后端上。主站只保留账号 / 充值 / 配额 / 签发 `sk-` / 模型网关联邦。

---

## 0. 一句话结论

做一个独立的 **chat-api**（常驻 Node，与 Next 前端分仓）：承接 sessions / skills / memories / files + Deep Research；`chat-llm-christmas` 继续做 UI；`llm-christmas` 门户卸下 `/portal/chat/*` 存储职责。

> 不放进 `chat-llm-christmas/apps/server`：前后端部署生命周期不同（Vercel vs VPS），独立目录更清晰。

---

## 1. 仓库与域名

| 组件 | 位置 | 域名 |
|------|------|------|
| 前端 | `~/Work/chat-llm-christmas` | `chat.llm.christmas` |
| 产品 API | `~/Work/chat-api` | `api.chat.llm.christmas`（CF DNS only） |
| 平台门户 | `~/Work/llm-christmas` | `llm.christmas` |
| 模型网关 | new-api | `api.llm.christmas` |

骨架已落地：`chat-api` 含 sessions/skills/memories/files 完整 CRUD、research API + worker 占位（管线 P0b）。

---

## 2. 边界

```text
llm.christmas（平台）              chat-api（产品）                 chat 前端（Vercel）
─────────────────────            ───────────────────             ────────────────
登录 / SSO / 签发 sk-             /v1/sessions|skills|memories    UI + 薄同源 API
充值 / 配额                        /v1/files|/v1/research
api.llm.christmas                  worker + 自有 SQLite
```

鉴权：Bearer `sk-` → 只读 `NEW_API_DB_PATH`（new-api tokens）解析 `user_id`。

---

## 3. 分期

### P0a — 底座
- [x] 创建 `~/Work/chat-api`（Hono + SQLite）
- [x] sessions / skills / memories / files + research 表与路由
- [x] research worker 占位
- [x] 部署 `api.chat.llm.christmas`（systemd + nginx + TLS）
- [x] 从门户迁移 sessions/skills/memories/files
- [x] 前端 `CHAT_BACKEND_BASE` 切到 `https://api.chat.llm.christmas`

### P0b — Deep Research 管线
- [x] planner / searcher / verifier / writer
- [x] 质量门禁；写回 session
- [x] 前端深度研究 UI

### P1+
- [ ] 澄清问 / 计划批准 / 三档模式 UI
- [ ] 门户下线 `/portal/chat/*`

### 明确不做
- 不把长任务塞进门户扫链进程
- 不自建第二套登录
- 不上 OpenClaw / research_pipeline.sh 本体

---

## 4. 给下一任 Agent

1. 后端代码在 **`/Users/kelen/Work/chat-api`**，不是 chat-llm-christmas 子目录。  
2. 先完成 P0a 部署与迁库，再写 research stages。  
3. 质量文案从 `skills-formyself/.../research_pipeline.sh` 抽取。
