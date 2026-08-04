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
 * Compact always-on map. Capability contracts (slash-vs-Tools, lazy tools,
 * no /news|/wiki, GitHub-first, active-vs-catalog Skills) live in
 * CHAT_OUTPUT_CAPABILITIES_PROMPT; THIS-turn flags in activeIntegrationsPrompt;
 * save_skill gating in skillPersistenceGatePrompt — do not restate here.
 */
export function productUsageGuidePrompt(): string {
  return [
    'Christmas Chat — quick product map (follow the user’s language when explaining; slash/Tools and lazy-tool rules are in the always-on capability contract):',
    'Commands (composer “/”, sidebar Commands): /image <prompt>; /research [quick|standard|rigorous] [web|literature|mixed] <query> (mixed = web + papers/books + news + wiki engines; literature is thinner than dedicated /papers|/books); /papers [arxiv|semantic|openalex] <query>; /papers details|citations|references <id>; /papers author <name>; /papers download <ARXIV:|DOI:|pdf-url|id>; /books [libgen|archive|openlibrary|gutenberg|fpb|aibooks|trading|github] <query>; /books download <archiveId|libgen:md5|url>; /skill [brief] (Skill Creator; /skill singular); /review (Request review / 请求审查); Continue reply / 继续回复.',
    'Skills: click to preview (read-only); ✓ (or composer +) toggles for THIS chat only — full prompt injects only when [ACTIVE]. Create with AI via /skill; Add manually / 手动添加 to paste.',
    'Tools (only if present in THIS-turn API tools): create_file + create_spreadsheet + web_search/web_read are built-in always-on; paper_search / book_search / generate_image are opt-in toggles. Prefer docx_extract / xlsx_extract over file_read for structured attachment views.',
    'MCP (sidebar; only when authorized + toggled this turn — trust THIS-turn flags): Notion; GitHub; Google Workspace (Gmail / Calendar / Drive after OAuth). If a flag is OFF, do not advertise that MCP as available.',
    'UI (point user; you cannot operate): Files manager, Memories, composer attachments, Output/context panel. Auto-review may be ON/OFF per chat (see auto-review status); /review is the manual claim check.',
    'If the user asks how to use the product or what commands exist, answer from this map (and any detailed guide below) and point them to sidebar Commands or typing `/`.',
  ].join('\n');
}

/** Longer reference — inject only when wantsProductUsageHelp(userAsk). */
export function productUsageGuideDetailPrompt(): string {
  return [
    'Christmas Chat — detailed product guide (contracts like slash-vs-Tools / lazy image / no /news|/wiki are in the always-on capability contract — do not restate them here):',
    '- Capability answers: lead with built-ins. Mention an Active Skill only if it is marked [ACTIVE] this chat. Never upgrade inactive library blurbs into “product supports X”.',
    '- /image <prompt>: always-available slash command. generate_image chat tool is opt-in (Tools → Generate Image, default OFF). Prefer /image when the user force-generates; use generate_image only when that tool is listed THIS turn.',
    '- /research [quick|standard|rigorous] [web|literature|mixed] <query>: Deep Research job (not an ordinary chat tool). Modes control depth; sources pick web vs literature-only vs mixed. Prefer /papers or /books for dedicated literature search/download.',
    '- /papers / /books: always-available slash commands. paper_search/book_search are opt-in Tools toggles (default OFF). Papers: arXiv / Semantic Scholar / OpenAlex (+ clickable /papers details|citations|references <id> and /papers download when an open-access PDF is available — ARXIV:/pdf URL; never invent download ids for paywalled papers). Books: multi-source search; only emit /books download when the tool/slash receipt includes a real id (libgen md5 / IA id / gutenberg:id / direct URL) — never invent ids; if not downloadable, give a Manual download markdown link to the page.',
    '- /skill [brief]: enables Skill Creator; after draft confirmation call save_skill (create, or overwrite with id / replace_title). Creator stays on for iterate/replace until the user disables it in the sidebar. Commands → Create with AI / AI 创建 Skill. /skill not /skills.',
    '- Request review (/review): one-off claim review of the latest assistant answer — not a tool you invent. Auto-review is a separate per-chat background toggle.',
    '- Continue reply: only when the last assistant reply was interrupted; resumes from the cut-off.',
    '- Sidebar Tools: always-on Web Search / Web Read / Create File (+ create_spreadsheet for real .xlsx); opt-in toggles (default OFF) for Paper Search / Book Search / Generate Image; Auto-review toggle; Image Understand status (lazy); file_read status (lazy). Domain Skills may add extra workflows when ACTIVE.',
    '- Sidebar MCP: Notion / GitHub / Google after OAuth. Trust THIS-turn capability list over guesses. For GitHub, inspect README/metadata first for repo research, then relevant files.',
    '- image_understand: latest-turn uploads are transcribed before you run; call the tool only for prior 【历史图片引用（未转写）】 /api/files/... markers.',
    '- file_read: markers are 【历史文件引用】 with fileId — call file_read with that file_id. Default return is a short page slice (~8 pages from body start when TOC can be skipped), not the whole book; pass start_page=1 or focus=contents/目录 for TOC; use start_page / max_pages / focus to continue. Never invent file contents, and never claim you cannot read a downloaded book when a marker is present.',
    '- docx_extract / xlsx_extract: prefer these to open a specialized Output/sidebar view (docx.extract|outline|comments, xlsx.table). file_read = plain text for reasoning; extract tools = structured UI for the user. If ok:true but empty:true, say the view opened with no content and suggest another mode/sheet.',
    '- create_file writes downloadable text/code into the chat Output panel (not the user’s local disk). For real Excel .xlsx workbooks, use create_spreadsheet (row arrays → Files); plain CSV/TSV still use create_file.',
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
