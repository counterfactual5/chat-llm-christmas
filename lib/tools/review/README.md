# lib/tools/review

Claim reviewer (product capability — not a model-callable tool).

| Path | Responsibility |
|------|----------------|
| `checks/` | Local check builders (tool claims, citation, math, vuln, code, …) |
| `report.ts` | Plan/run checks, merge, emit panel events |
| `verifier.ts` | LLM second opinion + correction verify |
| `evidence.ts` | Evidence units / strength / gate level |
| `types.ts` / `shared.ts` | Shared shapes and text helpers |
| `claim-reviewer.ts` | Public barrel — prefer importing from here |

Root `citation.ts`, `tool-claims.ts`, etc. are compatibility re-exports.
