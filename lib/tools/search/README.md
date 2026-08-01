# lib/tools/search

| Module | Responsibility |
|--------|----------------|
| `types.ts` | SearchHit / SearchOutcome / options |
| `freshness.ts` | Trim hits + stale year hints |
| `providers.ts` | Provider implementations + fallback order |
| `format.ts` | Model-facing JSON serialization |
| `engine.ts` | Orchestration + tool schema |
| `zhipu.ts` | Zhipu Coding Plan MCP client |
| `tool.ts` | Registered chat tool wrapper |
