import { describe, expect, it } from 'vitest';
import {
  oauthReturnNeedsUrlClean,
  parseOAuthReturnParams,
  planOAuthReturnUi,
} from '@/lib/chat/account/oauth-return';

describe('oauth-return', () => {
  it('parses provider return flags from the query string', () => {
    const p = parseOAuthReturnParams(
      '?notion_connected=1&github_auth=1&auth_error=denied',
    );
    expect(p.notionOk).toBe(true);
    expect(p.githubAuthReturn).toBe(true);
    expect(p.authError).toBe('denied');
    expect(oauthReturnNeedsUrlClean(p)).toBe(true);
  });

  it('asks for re-login when Notion connected but account unbound', () => {
    const actions = planOAuthReturnUi(
      parseOAuthReturnParams('?notion_connected=1'),
      false,
    );
    expect(actions).toEqual([
      {
        type: 'open_modal',
        mode: 'login',
        error:
          'Notion 已授权，但 llm.christmas 登录已失效。请先登录主站账号，再在 MCP 里重新连接 Notion。',
      },
    ]);
  });

  it('closes modal and enables Google surfaces when bound', () => {
    const actions = planOAuthReturnUi(
      parseOAuthReturnParams('?google_connected=1'),
      true,
    );
    expect(actions).toEqual([
      { type: 'close_modal' },
      { type: 'google_connected' },
    ]);
  });
});
