# lib/images

Cross-cutting image generation (not chat-UI-specific). Repo rules: [`docs/code-organization.md`](../../docs/code-organization.md).

| Module | Responsibility |
|--------|----------------|
| `generate-and-store.ts` | **SSOT** for image generation: gateway `images.generate` + upload PNG to Files API. Shared by `POST /api/images` and the `generate_image` chat tool (`lib/tools/image-generate`). |

Do not duplicate generate → base64 → Files upload in new call sites; extend this helper instead. Tool folders stay thin glue (schema + `execute`).
