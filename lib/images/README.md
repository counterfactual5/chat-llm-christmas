# lib/images

| Module | Responsibility |
|--------|----------------|
| `generate-and-store.ts` | **SSOT** for image generation: gateway `images.generate` + upload PNG to Files API. Shared by `POST /api/images` and the `generate_image` chat tool (`lib/tools/image-generate`). |

Do not duplicate generate → base64 → Files upload in new call sites; extend this helper instead.
