# chat-llm-christmas

## Getting Started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Docs

- [图片与文件附件](docs/images-and-files.md) — 直传、上下文折叠、`file_read` / 视觉路径

## Notion (hosted MCP)

Per-user Notion access uses [Notion's hosted MCP](https://developers.notion.com/guides/mcp/get-started-with-mcp) (`https://mcp.notion.com/mcp`), not a Public Integration token. Users connect via **Connect Notion** in the app (OAuth + PKCE).

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `INTEGRATIONS_ENCRYPTION_KEY` or `CHAT_SSO_SECRET` | Encrypts integration tokens in the HttpOnly vault cookie |
| `NOTION_MCP_CLIENT_ID` | Stable OAuth client id from dynamic registration (recommended for production refresh) |
| `NOTION_MCP_REDIRECT_URI` | Override callback URL (default: `{origin}/api/integrations/notion/callback`) |

`NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` are **not** used anymore.
