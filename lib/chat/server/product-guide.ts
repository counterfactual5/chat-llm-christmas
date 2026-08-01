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
    'Commands (composer “/”, sidebar Commands): /image <prompt> (client image gen — not a chat tool); /skill [brief] (Skill Creator → save_skill); Request review / 请求审查; Continue reply / 继续回复.',
    'Skills: toggle in sidebar or “/” skill names (only ACTIVE ones apply). Create with AI via /skill; Add manually / 手动添加 to paste a system prompt.',
    'Tools: only API tool-list entries — typically create_file (Output panel download); web_search/web_read if Tools search is on; MCP if connected+toggled; save_skill only while Skill Creator is on. When GitHub MCP is active, GitHub repo/file/issue/PR/release research uses GitHub tools before generic web tools.',
    'UI (point user; you cannot operate): Files manager, Memories, composer attachments, Output/context panel.',
    'If the user asks how to use the product or what commands exist, answer from this map (and any detailed guide below) and point them to sidebar Commands or typing `/`.',
  ].join('\n');
}

/** Longer reference — inject only when wantsProductUsageHelp(userAsk). */
export function productUsageGuideDetailPrompt(): string {
  return [
    'Christmas Chat — detailed product guide:',
    '- /image <prompt>: CLIENT command (Commands → Generate image / 生成图片). Never invent an image-generation chat tool.',
    '- /skill [brief]: enables Skill Creator; after draft confirmation call save_skill (create, or overwrite with id / replace_title). Creator stays on for iterate/replace until the user disables it in the sidebar. Commands → Create with AI / AI 创建 Skill.',
    '- Request review (/review in “/” menu): one-off claim review of the latest assistant answer — not a tool you invent.',
    '- Continue reply: resume an interrupted assistant reply from the UI.',
    '- Sidebar Tools can disable web search; sidebar MCP enables Notion/GitHub/Google after OAuth. Trust THIS-turn capability list over guesses.',
    '- When GitHub MCP is enabled for this chat, it is the primary path for GitHub repositories, files, issues, PRs, releases, and GitHub-hosted docs. The assistant should inspect README/metadata first for repo research, then the relevant files; generic webpage reading is fallback only when GitHub tools cannot access the resource.',
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
