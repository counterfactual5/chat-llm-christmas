# lib/integrations/store

Cookie + remote vault for Notion / GitHub / Google connections.

| Module | Responsibility |
|--------|----------------|
| `vault.ts` | Read/write/hydrate/clear vault cookies + remote KV |
| `notion.ts` | Notion MCP upsert/remove + access token refresh |
| `github.ts` | GitHub OAuth upsert/remove + access token |
| `google.ts` | Google OAuth upsert/remove + access token refresh |
| `index.ts` | Public barrel |

Root path `@/lib/integrations/store` resolves to this folder's `index.ts`.
