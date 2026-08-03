# Claim reviewer

产品内置的回答审查能力；不是 MCP，也不是提供给模型自行调用的工具。

## 目录职责

| Path | Responsibility |
|------|----------------|
| `claim-reviewer.ts` | **唯一公开入口**。应用层应从这里导入，避免耦合内部实现位置。 |
| `checks/` | 独立的本地审查器：工具回执、引用、重算、一致性、完整性、时效性、代码质量与漏洞。每个文件只负责一种审查维度。 |
| `core/types.ts` | 跨审查器共享的类型与审查结果模型。 |
| `core/shared.ts` | 无业务副作用的文本、URL、表格与代码块辅助函数。 |
| `core/evidence.ts` | 工具回执的证据单元、强度分级与审查门槛。 |
| `core/report.ts` | 组合本地检查、安排审查计划、合并结果并发送面板事件。 |
| `core/verifier.ts` | LLM 二次复核、纠正门槛与纠正文本验证。 |

## 导入规则

- **业务调用方**：使用 `@/lib/tools/review/claim-reviewer`。
- **审查器实现**：按需从 `core/` 或同级 `checks/` 导入。
- 不要在根目录新增 `citation.ts`、`report.ts` 等仅转发的兼容文件；它们会掩盖真实的职责归属。

## LLM 何时花费

- **自动审查（每轮 Auto-review）**：只跑本地 `checks/`，**不调用** LLM verifier。面板展示 findings；高置信度项才走短纠正（`actionableReviewIssues`）。
- **手动 `/review` / Request review**：本地检查 + LLM deep pass（Process 里可见 `claim_verifier`）。

## 自动纠正原则

审查面板可以展示建议性风险；自动纠正仅用于带稳定 `ruleId`/`verdict` 的高置信度问题（见 `actionableReviewIssues`）：工具回执冲突（含 `pending_intent`）、明确算术错误、回答被截断/代码围栏未闭合、强证据引用缺口、明确过期截止语、确定性代码 bug，以及本地漏洞规则命中。`mid_turn` 只做当场注入，终局不再二次纠正。教程、示例、条件句和语义不明确的内容不得自动打断回答。LLM lens 的自由文案不能单独触发纠正。
