/**
 * Parse / clear OAuth-return query params after Notion/GitHub/Google/main login.
 * Pure URL helpers — no fetch, no React.
 */

export type AuthModalMode = 'login' | 'notion' | 'github' | 'google';

export type OAuthReturnParams = {
  authError: string | null;
  notionOk: boolean;
  notionAuthReturn: boolean;
  githubOk: boolean;
  githubAuthReturn: boolean;
  googleOk: boolean;
  googleAuthReturn: boolean;
  mainConnected: boolean;
};

export function parseOAuthReturnParams(search: string): OAuthReturnParams {
  const params = new URLSearchParams(search);
  return {
    authError: params.get('auth_error'),
    notionOk: Boolean(params.get('notion_connected')),
    notionAuthReturn: Boolean(params.get('notion_auth')),
    githubOk: Boolean(params.get('github_connected')),
    githubAuthReturn: Boolean(params.get('github_auth')),
    googleOk: Boolean(params.get('google_connected')),
    googleAuthReturn: Boolean(params.get('google_auth')),
    mainConnected: Boolean(params.get('connected')),
  };
}

export function oauthReturnNeedsUrlClean(p: OAuthReturnParams): boolean {
  return Boolean(
    p.authError ||
      p.notionOk ||
      p.githubOk ||
      p.googleOk ||
      p.mainConnected ||
      p.notionAuthReturn ||
      p.githubAuthReturn ||
      p.googleAuthReturn,
  );
}

/** Strip query string from the current location (keeps pathname). */
export function clearOAuthReturnQuery(href: string = window.location.href): void {
  const clean = new URL(href);
  clean.search = '';
  window.history.replaceState({}, '', clean.pathname);
}

export type OAuthReturnUiAction =
  | { type: 'close_modal' }
  | { type: 'open_modal'; mode: AuthModalMode; error?: string }
  | { type: 'google_connected' };

/**
 * Decide modal UI after account status is known.
 * Returns ordered actions for the shell to apply.
 */
export function planOAuthReturnUi(
  p: OAuthReturnParams,
  bound: boolean,
): OAuthReturnUiAction[] {
  const actions: OAuthReturnUiAction[] = [];

  if (p.mainConnected) {
    actions.push({ type: 'close_modal' });
  }

  if (p.notionOk) {
    if (bound) actions.push({ type: 'close_modal' });
    else {
      actions.push({
        type: 'open_modal',
        mode: 'login',
        error:
          'Notion 已授权，但 llm.christmas 登录已失效。请先登录主站账号，再在 MCP 里重新连接 Notion。',
      });
    }
    return actions;
  }

  if (p.githubOk) {
    if (bound) actions.push({ type: 'close_modal' });
    else {
      actions.push({
        type: 'open_modal',
        mode: 'login',
        error:
          'GitHub 已授权，但 llm.christmas 登录已失效。请先登录主站账号，再在 MCP 里重新连接 GitHub。',
      });
    }
    return actions;
  }

  if (p.googleOk) {
    if (bound) {
      actions.push({ type: 'close_modal' });
      actions.push({ type: 'google_connected' });
    } else {
      actions.push({
        type: 'open_modal',
        mode: 'login',
        error:
          'Google 已授权，但 llm.christmas 登录已失效。请先登录主站账号，再在 MCP 里重新连接 Google。',
      });
    }
    return actions;
  }

  if (p.authError) {
    let mode: AuthModalMode = bound ? 'notion' : 'login';
    if (p.githubAuthReturn) mode = 'github';
    else if (p.googleAuthReturn) mode = 'google';
    else if (p.notionAuthReturn) mode = 'notion';
    actions.push({ type: 'open_modal', mode, error: p.authError });
    return actions;
  }

  if (p.notionAuthReturn && bound) {
    actions.push({ type: 'open_modal', mode: 'notion' });
  }
  if (p.githubAuthReturn && bound) {
    actions.push({ type: 'open_modal', mode: 'github' });
  }
  if (p.googleAuthReturn && bound) {
    actions.push({ type: 'open_modal', mode: 'google' });
  }

  return actions;
}
