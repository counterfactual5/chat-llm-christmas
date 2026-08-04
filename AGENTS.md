<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Where to put code (read first)

**Structure & module rules:** [`docs/code-organization.md`](docs/code-organization.md) — organize by feature domain; split reusable / independently testable pieces; keep `app` / `components` / `hooks` / `lib` layers thin and one-way.

Domain maps (after the doc above):

- Chat layout & placement: `lib/chat/README.md`. Do not pile new logic into `components/chat-container.tsx`.
- Server tool loop: `lib/chat/server/README.md`.
- Claim review / markdown: `lib/tools/review/README.md`, `lib/markdown/README.md`.
- Files / preview / downloads: `lib/files/README.md`.
- Image generate+store: `lib/images/README.md`.
