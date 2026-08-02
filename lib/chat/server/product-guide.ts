/**
 * Product usage guide for Christmas Chat.
 * Short always-on summary + optional detailed block when the user asks how to use the product.
 */

/** Detect “how do I use this / what commands exist” style asks. */
export function wantsProductUsageHelp(text: string): boolean {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (t.length > 400) return false;
  return (
    /怎么用|如何使用|使用说明|功能介绍|有什么(命令|功能|能力)|有哪些(命令|功能)|内置命令|产品(怎么|功能)|怎么操作/.test(
      t,
    ) ||
    /what can you do|how (do i|to) use|what (commands|features)|slash commands?|product (help|guide)|help me use/.test(
      t,
    )
  );
}

/**
 * Compact always-on map. Live THIS-turn toggles live in activeIntegrationsPrompt /
 * skillPersistenceGatePrompt — do not duplicate those here.
 */
export function productUsageGuidePrompt(): string {
  return [
    'Christmas Chat — quick product map (follow the user’s language when explaining):',
    'When listing capabilities, separate (1) built-in product features below from (2) [ACTIVE] Skills whose full prompts are injected this chat. Account Skills library blurbs (title + short description) are catalog only — NOT product features and NOT active instructions unless marked [ACTIVE]. Do not present inactive Skill blurbs as core product capabilities.',
    'Commands (composer “/”, sidebar Commands): /image <prompt> (client image gen — not a chat tool); /research [quick|standard|rigorous] [web|literature|mixed] <query> (Deep Research; literature/mixed is thinner than dedicated /papers|/books); /papers [arxiv|semantic|openalex] <query>; /papers details|citations|references <id>; /papers author <name>; /books [libgen|archive|openlibrary|gutenberg|fpb|aibooks|trading|github] <query>; /books download <archiveId|libgen:md5|url> (IA / LibGen / direct → Files); /skill [brief] (Skill Creator → save_skill; command is /skill singular, not /skills); /review (Request review / 请求审查); Continue reply / 继续回复.',
    'Skills: click a Skill to preview (read-only). Use the ✓ beside it (or composer +) to add/remove for THIS chat only — full prompt injects only when active. Create with AI via /skill; Add manually / 手动添加 to paste. Optional description is a short library blurb; otherwise the model sees a content excerpt.',
    'Tools (only if present in THIS-turn API tool list / capability flags): create_file (Output panel download); web_search/web_read are built-in always-on (public web/news/docs — cite source+time; not a dedicated finance/market data feed); image_understand on text-only models for prior-turn images marked 【历史图片引用（未转写）】 (vision chat models see images natively — no image_understand); save_skill only while Skill Creator is ON.',
    'MCP (sidebar; only when authorized + toggled this turn — trust THIS-turn flags): Notion; GitHub (prefer GitHub tools over generic web for github.com repos/files/issues/PRs/releases); Google Workspace (Gmail / Calendar / Drive after OAuth); zhipu-vision (helps text-only models with images). If a flag is OFF, do not advertise that MCP as available.',
    'UI (point user; you cannot operate): Files manager, Memories, composer attachments, Output/context panel. Auto-review may be ON/OFF per chat (see auto-review status); /review is the manual claim check.',
    'If the user asks how to use the product or what commands exist, answer from this map (and any detailed guide below) and point them to sidebar Commands or typing `/`.',
  ].join('\n');
}

/** Longer reference — inject only when wantsProductUsageHelp(userAsk). */
export function productUsageGuideDetailPrompt(): string {
  return [
    'Christmas Chat — detailed product guide:',
    '- Capability answers: lead with built-ins. Mention an Active Skill only if it is marked [ACTIVE] this chat. Never upgrade inactive library blurbs into “product supports X”.',
    '- /image <prompt>: CLIENT command (Commands → Generate image / 生成图片). Never invent an image-generation chat tool.',
    '- /research [quick|standard|rigorous] [web|literature|mixed] <query>: Deep Research job (not an ordinary chat tool). Modes control depth; sources pick web vs literature vs mixed. literature/mixed reuse academic/book providers thinly — prefer /papers or /books for dedicated literature search/download.',
    '- /papers / /books: slash commands (not chat tools). Papers: arXiv / Semantic Scholar / OpenAlex (+ details/citations/references/author). Books: multi-source search + download into Files.',
    '- /skill [brief]: enables Skill Creator; after draft confirmation call save_skill (create, or overwrite with id / replace_title). Creator stays on for iterate/replace until the user disables it in the sidebar. Commands → Create with AI / AI 创建 Skill. Spelling: /skill not /skills.',
    '- Request review (/review): one-off claim review of the latest assistant answer — not a tool you invent. Auto-review is a separate per-chat background toggle.',
    '- Continue reply: resume an interrupted assistant reply from the UI.',
    '- Sidebar Tools lists built-in always-on tools (Web Search / Web Read / Create File) plus Auto-review (toggle) and Image Understand (status). There is no first-class finance/crypto/FX data product — with web search you may look up public market/news pages and must label source, time, and whether data is live vs historical. Domain Skills may add extra workflows when ACTIVE.',
    '- Sidebar MCP: Notion / GitHub / Google after OAuth; zhipu-vision needs a bound account. Trust THIS-turn capability list over guesses.',
    '- When GitHub MCP is enabled for this chat, it is the primary path for GitHub repositories, files, issues, PRs, releases, and GitHub-hosted docs. Inspect README/metadata first for repo research, then relevant files; generic webpage reading is fallback only when GitHub tools cannot access the resource.',
    '- image_understand: text-only models only, when listed in tools — describe/OCR a prior image via its /api/files/... marker. Do not claim you “see” pixels without that tool receipt or a vision model.',
    '- create_file writes downloadable text/code into the chat Output panel (not the user’s local disk).',
    '- Files / Memories / attachments are UI surfaces — guide the user there; do not claim you clicked them.',
  ].join('\n');
}

/** Always-on memory behavior contract (separate from the optional facts block). */
export function memoryBehaviorPrompt(): string {
  return [
    'Memory: facts may be auto-extracted into the Memories UI. No memory-write tool.',
    'If asked to “remember” something, acknowledge it — do NOT claim it was saved unless it already appears in Known facts below.',
  ].join(' ');
}

/** Short auto-review product status (not the full reviewer rubric). */
export function autoReviewStatusPrompt(opts: {
  autoReview: boolean;
  requestReview: boolean;
}): string {
  if (opts.requestReview) {
    return [
      'Claim review: the user manually requested a review this turn (Request review / /review).',
      'Auto-review in the background is separate; do not invent a review tool — the product runs the audit.',
    ].join(' ');
  }
  if (opts.autoReview) {
    return [
      'Auto-review is ON for this chat: after replies the product may audit this turn’s claims vs its tool receipts.',
      'That is product background behavior, not a tool you call. Manual Request review / /review reviews more broadly on demand.',
    ].join(' ');
  }
  return [
    'Auto-review is OFF for this chat. The user can still run Request review / /review from Commands when they want a claim check.',
  ].join(' ');
}
