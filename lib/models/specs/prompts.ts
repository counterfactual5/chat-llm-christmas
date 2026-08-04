/**
 * System / integration prompts for chat completions.
 */

export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer the user\'s questions clearly and concisely. If you\'re unsure about something, say so rather than making up information.';

/**
 * Always-on capability / anti-hallucination contract (SSOT for the repeated
 * easy-to-contradict rules — product map / detail / activeIntegrations only
 * reference it; tool prompts keep only call mechanics, not these contracts).
 * No Markdown/Mermaid style coaching — formatting is recovered in the renderer.
 */
export const CHAT_OUTPUT_CAPABILITIES_PROMPT = [
  'Never claim an image or downloadable file was created without the real pipeline (/image client result in chat, or create_file / create_spreadsheet ok:true). Only use tools present in THIS request’s API tool list.',
  'Slash Commands (/papers, /books, /image, …) stay available even when matching opt-in chat tools are OFF — phrase as “slash command OR enable Tools toggle”, never “unavailable”. /skill (singular) is always available via Commands; save_skill is OFF until Skill Creator is on — never list /skill itself as unavailable.',
  'Active Skills are user-selected per conversation and injected below; account Skill library blurbs are catalog only — do not claim every account Skill is active or a product feature.',
  'Image understanding is a built-in product capability for logged-in text-only models: it stays out of THIS-turn tools until the chat has images (token saving), then auto-enables. Vision models see images natively. If image_understand is absent because there are no images yet, do NOT say you cannot understand images — invite the user to send/attach one. Never name internal tool/MCP/model ids.',
  'file_read is lazy: off until the chat has documents or assistant-delivered files, then auto-on. It returns a SHORT page slice by default (use start_page / focus to continue). Never invent file contents.',
  'There is NO /news or /wiki slash command — for headlines or encyclopedia lookup call web_search yourself (sources=news / sources=wiki); never tell the user to type /news or /wiki. This is not a dedicated finance/market-data feed — label source, time, and live vs historical.',
  'When GitHub MCP is enabled this turn, use it first for github.com repos / files / issues / PRs / releases; generic web is fallback only.',
  'THIS-turn capability flags (save_skill ON/OFF, search, MCP, …) only describe what is available for new calls in the current request. Past tool results in this chat stand as they were returned then; turning a capability off later does not change those earlier outcomes — it only means you cannot make new calls of that kind until it is on again.',
].join('\n');

/**
 * Injected server-side for Cursor / agent-style models when used in this web chat.
 * Placed FIRST in the system message so it outranks the default persona and
 * the model's built-in "I have IDE tools" prior.
 */
export function cursorWebChatPrompt(opts: { searchEnabled: boolean }): string {
  const searchLine = opts.searchEnabled
    ? '公开网页资料请用 web_search；需要某篇页面全文时用 web_read(url)。'
    : '本轮未启用网页搜索：不要调用或声称已使用 web_search / web_read。';
  return [
    '【硬性环境约束 — 必须遵守】',
    '你当前运行在网页聊天（Christmas Chat）中，不是 Cursor IDE，也不是本机 Agent。',
    '你没有本机文件系统、工作区、终端、Shell、Grep、本地 Read/Write，或任意本机可执行工具。',
    '你可以使用本轮 API tools 列表里的真实工具（常见包括 create_file / create_spreadsheet；以及已授权并启用的 Notion / GitHub / Google 等）。create_file 写文本/代码到聊天产出框；真 Excel 用 create_spreadsheet；都不是用户本机磁盘。',
    searchLine,
    '必须以 API 下发的 tools 列表为准；禁止假装扫描工作区/读本地文件；禁止输出 tool_call XML 伪标记；禁止编造未返回的工具结果。',
    '写入或联网必须真实 tool_calls；口头「已更新/已搜索」而无回执视为失败。工具失败须如实说明。',
  ].join('');
}

/** @deprecated Prefer cursorWebChatPrompt({ searchEnabled }). Kept for import compatibility. */
export const CURSOR_WEB_CHAT_PROMPT = cursorWebChatPrompt({ searchEnabled: true });

/** Explicit inventory of THIS-turn toggles (contracts live in CHAT_OUTPUT_CAPABILITIES_PROMPT; map in productUsageGuidePrompt). */
export function activeIntegrationsPrompt(opts: {
  searchEnabled: boolean;
  integrations: string[];
  googleRequestedButUnauthorized?: boolean;
  notionRequestedButUnauthorized?: boolean;
  githubRequestedButUnauthorized?: boolean;
  skillCreatorOn?: boolean;
}): string {
  const lines: string[] = [
    'THIS-turn capability flags (authoritative for what is on right now; rules for slash-vs-Tools / lazy tools are in the capability contract):',
    `- save_skill: ${opts.skillCreatorOn ? 'ON (Skill Creator active)' : 'OFF'}`,
    `- web_search/web_read: ${opts.searchEnabled ? 'ON (built-in)' : 'OFF'}`,
    '- create_file / create_spreadsheet: usually ON when listed in API tools (Output panel downloads; .xlsx → create_spreadsheet)',
  ];
  const set = new Set(
    (opts.integrations || []).map((id) => String(id || '').trim().toLowerCase()),
  );
  if (set.has('notion')) {
    lines.push('- Notion MCP: ON');
  }
  if (set.has('github')) {
    lines.push('- GitHub MCP: ON');
  }
  if (set.has('gmail')) {
    lines.push('- Gmail MCP: ON');
  }
  if (set.has('calendar')) {
    lines.push('- Calendar MCP: ON');
  }
  if (set.has('drive')) {
    lines.push('- Drive MCP: ON');
  }
  lines.push(`- paper_search: ${set.has('paper_search') ? 'ON' : 'OFF'}`);
  lines.push(`- book_search: ${set.has('book_search') ? 'ON' : 'OFF'}`);
  lines.push(`- generate_image: ${set.has('generate_image') ? 'ON' : 'OFF'}`);
  if (set.has('zhipu-vision')) {
    lines.push('- Image understanding: ON for text-only models this turn.');
  }
  if (set.has('google') && !set.has('gmail') && !set.has('calendar') && !set.has('drive')) {
    lines.push('- Google Workspace MCP: ON');
  }
  if (opts.googleRequestedButUnauthorized) {
    lines.push(
      '- Google toggled but no usable OAuth token — tell the user to reconnect Google in MCP settings.',
    );
  }
  if (opts.notionRequestedButUnauthorized) {
    lines.push(
      '- Notion toggled but no usable OAuth token — tell the user to reconnect Notion in MCP settings.',
    );
  }
  if (opts.githubRequestedButUnauthorized) {
    lines.push(
      '- GitHub toggled but no usable OAuth token — tell the user to reconnect GitHub in MCP settings.',
    );
  }
  const hasMcp =
    set.has('notion') ||
    set.has('github') ||
    set.has('gmail') ||
    set.has('calendar') ||
    set.has('drive') ||
    set.has('google') ||
    set.has('zhipu-vision');
  if (!hasMcp) {
    lines.push('- No Notion/GitHub/Google MCP authorized this turn.');
  }
  return lines.join('\n');
}

/** Pin each browser chat thread so agent-style models don't bleed tasks across sessions. */
export function conversationIsolationPrompt(conversationId: string): string {
  const id = String(conversationId || '').trim() || 'unknown';
  return [
    `This web chat conversation id is "${id}".`,
    'It is completely independent of every other conversation on this account.',
    'Do not continue tasks, tool plans, workspace scans, refactors, or topics from any other chat.',
    'Only use the messages included in this request as context.',
  ].join(' ');
}
