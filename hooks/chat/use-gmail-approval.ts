'use client';

import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ChatSession } from '@/lib/chat/types';
import type { GmailApprovalDraft } from '@/lib/mcp/google/gmail-approval';
import { withResolvedGmailApproval } from '@/lib/chat/session/mutations';

/**
 * Client-side confirm/cancel for Gmail send-family approval cards.
 */
export function useGmailApproval(opts: {
  setSessions: Dispatch<SetStateAction<ChatSession[]>>;
  activeSessionId: string | null;
}) {
  const { setSessions, activeSessionId } = opts;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onGmailApproval = useCallback(
    async (
      messageId: string,
      toolRunId: string,
      action: 'send' | 'cancel',
      draft: GmailApprovalDraft,
    ) => {
      if (!activeSessionId) return;
      setBusyId(toolRunId);
      setError(null);
      try {
        const res = await fetch('/api/integrations/google/gmail/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, draft }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          status?: string;
        };
        if (!res.ok || payload.ok === false) {
          throw new Error(payload.error || `HTTP ${res.status}`);
        }
        setSessions((prev) =>
          withResolvedGmailApproval(prev, activeSessionId, messageId, toolRunId, {
            approvalOutcome: action === 'send' ? 'sent' : 'cancelled',
            results:
              action === 'send'
                ? [
                    {
                      title: draft.subject || 'Email',
                      url: '',
                      snippet: `To: ${draft.to}`,
                    },
                  ]
                : [{ title: 'Cancelled', url: '', snippet: 'User cancelled send' }],
          }),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err || 'Failed');
        setError(message);
        if (action === 'cancel') {
          // Cancel itself failed to reach the API — still mark local cancel.
          setSessions((prev) =>
            withResolvedGmailApproval(prev, activeSessionId, messageId, toolRunId, {
              approvalOutcome: 'cancelled',
              error: message,
            }),
          );
        }
      } finally {
        setBusyId(null);
      }
    },
    [activeSessionId, setSessions],
  );

  return {
    onGmailApproval,
    gmailApprovalBusyId: busyId,
    gmailApprovalError: error,
  };
}
