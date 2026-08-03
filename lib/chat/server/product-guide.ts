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
    'CRITICAL — do not contradict yourself: slash Commands (/papers, /books, /image, /research, /review, …) are ALWAYS available via composer “/” or sidebar Commands. Opt-in Tools toggles (Paper Search / Book Search / Generate Image) are an alternate path so YOU can call paper_search / book_search / generate_image mid-reply without a slash. When listing capabilities, say each is available via the slash command OR by enabling the matching Tools switch — never put /papers|/books|/image under “不可用 / unavailable”, and never imply the only way is the Tools switch.',
    'Commands (composer “/”, sidebar Commands): /image <prompt> (client image gen — not a chat tool); /research [quick|standard|rigorous] [web|literature|mixed] <query> (Deep Research; mixed = web + papers/books + news + wiki engines; literature is thinner than dedicated /papers|/books); /papers [arxiv|semantic|openalex] <query>; /papers details|citations|references <id>; /papers author <name>; /books [libgen|archive|openlibrary|gutenberg|fpb|aibooks|trading|github] <query>; /books download <archiveId|libgen:md5|url> (IA / LibGen / direct → Files); /skill [brief] (Skill Creator → save_skill; command is /skill singular, not /skills); /review (Request review / 请求审查); Continue reply / 继续回复.',
    'Skills: click a Skill to preview (read-only). Use the ✓ beside it (or composer +) to add/remove for THIS chat only — full prompt injects only when active. Create with AI via /skill; Add manually / 手动添加 to paste. Optional description is a short library blurb; otherwise the model sees a content excerpt.',
    'Tools (only if present in THIS-turn API tool list / capability flags): create_file + web_search/web_read are built-in always-on (public web — cite source+time; when the ask needs headlines or encyclopedia lookup, call web_search with sources=news or sources=wiki yourself. There is NO /news or /wiki slash command — never tell the user to type /news or /wiki; not a dedicated finance/market data feed). file_read is lazy (off until the chat has attached documents, then auto-ON) — re-read full text from a 【历史文件引用】 fileId when the short preview is not enough. paper_search / book_search / generate_image are OPT-IN Tools toggles (default OFF to save tokens). Capability phrasing: “可用：打 /papers|/books|/image，或在 Tools 打开对应开关”。When OFF, YOU cannot call those tools mid-reply; the user can still use the slash. image_understand is lazy for logged-in text-only models (off until the chat has images, then auto-ON); vision models see images natively. If image_understand is absent because there are no images yet, do NOT say you cannot understand images — invite the user to send one (never name internal tool/MCP/model ids). save_skill only while Skill Creator is ON (/skill turns it on — do not list /skill itself as unavailable).',
    'MCP (sidebar; only when authorized + toggled this turn — trust THIS-turn flags): Notion; GitHub (prefer GitHub tools over generic web for github.com repos/files/issues/PRs/releases); Google Workspace (Gmail / Calendar / Drive after OAuth). If a flag is OFF, do not advertise that MCP as available.',
    'UI (point user; you cannot operate): Files manager, Memories, composer attachments, Output/context panel. Auto-review may be ON/OFF per chat (see auto-review status); /review is the manual claim check.',
    'If the user asks how to use the product or what commands exist, answer from this map (and any detailed guide below) and point them to sidebar Commands or typing `/`.',
  ].join('\n');
}

/** Longer reference — inject only when wantsProductUsageHelp(userAsk). */
export function productUsageGuideDetailPrompt(): string {
  return [
    'Christmas Chat — detailed product guide:',
    '- Capability answers: lead with built-ins. Mention an Active Skill only if it is marked [ACTIVE] this chat. Never upgrade inactive library blurbs into “product supports X”.',
    '- Never list /papers, /books, or /image as “unavailable” just because paper_search / book_search / generate_image Tools toggles are OFF. Correct phrasing: available via slash command OR by enabling the matching Tools switch. Only MCP (Notion/GitHub/Google) and save_skill (until /skill) belong in a true “not available this turn” bucket.',
    '- /image <prompt>: always-available slash command (does not need the Tools toggle). generate_image chat tool is opt-in (Tools → Generate Image, default OFF). Prefer /image when the user force-generates; use generate_image only when that tool is listed THIS turn.',
    '- /research [quick|standard|rigorous] [web|literature|mixed] <query>: Deep Research job (not an ordinary chat tool). Modes control depth; sources pick web vs literature-only vs mixed (mixed = web + papers/books + news + wiki engines). For one-shot news/encyclopedia lookup in ordinary chat, YOU call web_search with sources=news or sources=wiki — never invent or recommend /news or /wiki. Prefer /papers or /books for dedicated literature search/download.',
    '- /papers / /books: always-available slash commands (no Tools toggle needed). paper_search/book_search are opt-in Tools toggles (default OFF) so the model can search mid-reply without a slash — when OFF, still tell the user to type /papers or /books. Papers: arXiv / Semantic Scholar / OpenAlex (+ clickable /papers details|citations|references <id> in results). Books: multi-source search; only emit /books download when the tool/slash receipt includes a real id (libgen md5 / IA id / gutenberg:id / direct URL) — never invent ids; if not downloadable, give a Manual download markdown link to the page.',
    '- /skill [brief]: enables Skill Creator; after draft confirmation call save_skill (create, or overwrite with id / replace_title). Creator stays on for iterate/replace until the user disables it in the sidebar. Commands → Create with AI / AI 创建 Skill. Spelling: /skill not /skills. Listing /skill under “unavailable” is wrong — tell the user to run /skill to turn Creator on.',
    '- Request review (/review): one-off claim review of the latest assistant answer — not a tool you invent. Auto-review is a separate per-chat background toggle.',
    '- Continue reply: only when the last assistant reply was interrupted; resumes from the cut-off.',
    '- Sidebar Tools: always-on Web Search / Web Read / Create File; opt-in toggles (default OFF) for Paper Search / Book Search / Generate Image (slash commands still work when off); Auto-review toggle; Image Understand status (lazy); file_read status (lazy when documents are attached). There is no first-class finance/crypto/FX data product — with web search you may look up public market/news pages and must label source, time, and whether data is live vs historical. Domain Skills may add extra workflows when ACTIVE.',
    '- Sidebar MCP: Notion / GitHub / Google after OAuth. Trust THIS-turn capability list over guesses.',
    '- When GitHub MCP is enabled for this chat, it is the primary path for GitHub repositories, files, issues, PRs, releases, and GitHub-hosted docs. Inspect README/metadata first for repo research, then relevant files; generic webpage reading is fallback only when GitHub tools cannot access the resource.',
    '- image_understand: built-in for logged-in text-only models; lazy — not injected into tools until the chat has images (token saving), then auto-ON. Latest-turn uploads are transcribed before you run; call the tool only for prior 【历史图片引用（未转写）】 /api/files/... markers. Vision models see pixels natively (no image_understand). If the tool is absent this turn and there are no images yet, do NOT claim you cannot understand images — explain it auto-enables when an image is sent. Never name internal tool/MCP/model ids.',
    '- file_read: lazy built-in when the chat has attached PDF/DOCX/text docs. Latest-turn attaches include full extracted text; older turns show 【历史文件引用】 with a short preview + fileId — call file_read with that file_id to re-read the full body. Never invent file contents.',
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
