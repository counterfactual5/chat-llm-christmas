<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

Chat layout & placement: see `lib/chat/README.md` (read first). Do not pile new logic into `components/chat-container.tsx` — follow that README’s placement section.
Server tool loop: `lib/chat/server/README.md`.
When touching claim review / markdown: `lib/tools/review/README.md`, `lib/markdown/README.md`.
