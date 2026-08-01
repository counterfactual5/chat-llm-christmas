# lib/files

Client-side file ingestion + gateway Files API helpers. Public import paths
(`@/lib/files/ingest`, `@/lib/files/gateway`) are folder barrels — internals
are grouped by function underneath.

## `ingest/`

| Module | Responsibility |
|--------|----------------|
| `types.ts` | `IngestedAttachment` shape |
| `support.ts` | `isSupportedDropFile` — drop/pick file-type gate |
| `extractors.ts` | Per-format read: data URL, PDF text, DOCX text |
| `index.ts` | `ingestFile` / `ingestFiles` orchestration (barrel) |

## `gateway/`

| Module | Responsibility |
|--------|----------------|
| `types.ts` | `GatewayFileRef` shape |
| `base.ts` | `gatewayBaseURL`, `resolveUploadModel` |
| `data-url.ts` | `parseDataUrl` — decode `data:` URLs to bytes |
| `upload.ts` | `uploadGatewayFile` / `uploadGatewayDataUrl` / `uploadGatewayBase64Png` |
| `content-parts.ts` | `toImageContentPart` — Chat Completions image content part |
| `prompts.ts` | `generatedImageAssistantSummary` — post-generation assistant stub |
| `index.ts` | Re-exports the above (barrel) |
