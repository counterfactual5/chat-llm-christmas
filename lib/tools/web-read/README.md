# lib/tools/web-read

| Module | Responsibility |
|--------|----------------|
| `types.ts` | Outcome type + content/size limits |
| `url.ts` | Normalize URL + hostname blocklist |
| `extract.ts` | HTML / embedded-JSON main-text extraction |
| `fetchers.ts` | Zhipu / Tavily / Jina / bare-fetch providers |
| `zhipu.ts` | Zhipu Coding Plan MCP client |
| `reader.ts` | Fallback chain + format + tool schema |
| `tool.ts` | Registered chat tool wrapper |
