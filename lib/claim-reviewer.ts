/**
 * Claim Reviewer — single layer that catches narrated tool successes without
 * real tool_calls (mid-turn correction + post-audit). Product capability, not
 * MCP, not a model-callable tool.
 */

export type FakedToolSurface =
  | 'notion'
  | 'github'
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'web_search'
  | 'web_read'
  | 'save_skill';

export const REVIEWER_SYSTEM_PROMPT = [
  '【Claim Reviewer — 硬性约束】',
  '任何「已创建/已更新/已发送/根据搜索/已保存」类声明，必须对应本轮真实 tool_calls 的成功回执。',
  '只口头叙述而没有 tool_calls = 失败，必须立即发出真实 tool_calls，或明确撤回并禁止编造 notion.so / github.com / google.com 等链接。',
].join('');

/** Detect narrated successes scoped to enabled surfaces. */
export function detectFakedToolNarration(
  text: string,
  opts: { searchEnabled: boolean; integrations: string[]; skillCreator?: boolean },
): FakedToolSurface[] {
  const t = String(text || '');
  if (!t.trim()) return [];
  const set = new Set(
    (opts.integrations || []).map((id) => String(id || '').trim().toLowerCase()),
  );
  const found: FakedToolSurface[] = [];

  if (set.has('notion')) {
    const hasNotionUrl = /(app\.notion\.com|notion\.so|notion\.site)\//i.test(t);
    const claimsWrite =
      /(正在(更新|写入|创建)|已(经)?(更新|写入|创建|改好|重构)|更新页面|写入.*页面|按你的要求重构|创建了?(这个|一个)?(页面|模板))/i.test(
        t,
      ) || /(updated|created|wrote|writing)\s+(the\s+)?(notion\s+)?page/i.test(t);
    if (claimsWrite && (hasNotionUrl || /notion|页面|模板/i.test(t))) found.push('notion');
  }

  if (set.has('github')) {
    const hasGhUrl = /github\.com\//i.test(t);
    const claimsWrite =
      /(创建|提交|打开|评论).{0,12}(issue|PR|pull request|拉取请求)|已(创建|提交|评论|打开).{0,12}(issue|PR)|created (an? )?(issue|PR|pull request)|opened (an? )?(PR|pull request)|commented on/i.test(
        t,
      );
    if (claimsWrite || (hasGhUrl && /(创建|提交|issue|PR|pull request)/i.test(t))) found.push('github');
  }

  if (set.has('gmail')) {
    if (
      /(已(经)?(发送|回复|转发)|正在发送).{0,8}(邮件|邮箱|gmail)|sent (the )?(email|mail)|replied to/i.test(t) ||
      (/mail\.google\.com|gmail/i.test(t) && /(发送|回复|sent|reply)/i.test(t))
    ) {
      found.push('gmail');
    }
  }

  if (set.has('calendar')) {
    if (
      /(已(经)?(创建|添加|安排)|正在(创建|添加)).{0,10}(日程|日历|会议|event)|created (a )?(calendar )?event|scheduled/i.test(t) ||
      (/calendar\.google\.com/i.test(t) && /(创建|日程|event|scheduled)/i.test(t))
    ) {
      found.push('calendar');
    }
  }

  if (set.has('drive')) {
    if (
      /(已(经)?(上传|创建|分享)|正在(上传|创建)).{0,10}(文件|文档|Drive|网盘)|uploaded (a )?file|created (a )?doc/i.test(t) ||
      (/drive\.google\.com/i.test(t) && /(上传|创建|分享|upload)/i.test(t))
    ) {
      found.push('drive');
    }
  }

  if (opts.searchEnabled) {
    if (
      /(根据(联网)?搜索|搜索(结果|显示|表明)|查到了|检索到)|according to (my |the )?(web )?search|I found the following links/i.test(t) &&
      /https?:\/\//i.test(t)
    ) {
      found.push('web_search');
    }
    if (
      /(我(已经|已)?读完|根据(该|此)页|页面内容显示)|I (have )?read (the )?(page|article)|according to the page/i.test(t) &&
      /https?:\/\//i.test(t)
    ) {
      found.push('web_read');
    }
  }

  if (opts.skillCreator) {
    if (
      /(已(经)?(保存|存入)|保存成功|skill 已(经)?保存|saved (the )?skill)/i.test(t) &&
      /skill/i.test(t)
    ) {
      found.push('save_skill');
    }
  }

  return found;
}

const SURFACE_LABELS: Record<FakedToolSurface, string> = {
  notion: 'Notion write',
  github: 'GitHub write',
  gmail: 'Gmail send/reply',
  calendar: 'Google Calendar write',
  drive: 'Google Drive write',
  web_search: 'web_search',
  web_read: 'web_read',
  save_skill: 'save_skill',
};

export function buildCorrectionPrompt(surfaces: FakedToolSurface[]): string {
  const list = surfaces.map((s) => SURFACE_LABELS[s]).join(', ');
  return [
    `You claimed a successful tool action (${list}) in the message above, but you did not emit any tool_calls in THIS turn.`,
    'Do one of the following now via real API tool_calls: call the appropriate tool(s) with real arguments from prior results,',
    'OR clearly retract the claim and say the action was NOT performed — do not invent notion.so / github.com / google.com result links or fake tool payloads.',
  ].join(' ');
}

export type ReviewerPhase = 'mid' | 'audit' | 'requested';

/** SSE tool row so the Reviewer appears in Process. */
export function emitReviewerStep(
  send: (payload: Record<string, unknown>) => void,
  opts: {
    status: 'start' | 'done';
    phase: ReviewerPhase;
    surfaces?: FakedToolSurface[];
    error?: string;
  },
): void {
  const surfaces = opts.surfaces || [];
  send({
    tool: {
      name: 'claim_reviewer',
      status: opts.status,
      provider: 'claim-reviewer',
      query:
        opts.phase === 'audit'
          ? 'post-audit'
          : opts.phase === 'requested'
            ? 'requested review'
            : surfaces.length
              ? surfaces.map((s) => SURFACE_LABELS[s]).join(', ')
              : 'auto review',
      error: opts.error,
      results:
        opts.status === 'done'
          ? [
              {
                title:
                  opts.phase === 'audit'
                    ? 'Post-audit: claims without tool receipts'
                    : 'Narrated tool success without tool_calls',
                url: '',
                snippet: surfaces.map((s) => SURFACE_LABELS[s]).join(', ') || 'none',
              },
            ]
          : undefined,
    },
  });
}
