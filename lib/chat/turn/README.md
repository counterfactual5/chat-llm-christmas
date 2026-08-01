# lib/chat/turn

Client turn planning helpers. Hooks still own React state + streaming.

| Module | Responsibility |
|--------|----------------|
| `task-queue.ts` | Queue drain / pause / remove |
| `continuation.ts` | Continue gate, branch, resume stream plan |
| `attachments.ts` | Attachment gates + user content assembly |
| `send-estimate.ts` | Pre-send token projection / compact thresholds |
| `stream-error.ts` | Stream/image failure message patches |
| `compact.ts` | History compact API helper |
| `image-command.ts` | `/image` prompt parse |
