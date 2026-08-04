import { describe, expect, it, vi } from 'vitest';
import {
  awaitingApprovalToolResult,
  executeApprovedGmailDraft,
  isGmailApprovalTool,
} from '@/lib/mcp/google/gmail-approval';

vi.mock('@/lib/integrations/google/gmail', () => ({
  gmailSendMessage: vi.fn(async (_token: string, opts: { to: string }) => ({
    id: 'sent-1',
    to: opts.to,
  })),
  gmailReplyMessage: vi.fn(async () => ({ id: 'reply-1' })),
  gmailForwardMessage: vi.fn(async () => ({ id: 'fwd-1' })),
  gmailSendDraft: vi.fn(async () => ({ id: 'draft-sent' })),
  gmailDeleteDraft: vi.fn(async () => ({ ok: true })),
  gmailGetMessage: vi.fn(async () => ({
    from: 'a@example.com',
    to: 'me@example.com',
    subject: 'Hello',
    bodyText: 'Hi',
    threadId: 't1',
    messageIdHeader: '<x@y>',
  })),
}));

describe('gmail approval helpers', () => {
  it('recognizes send-family tools', () => {
    expect(isGmailApprovalTool('gmail_send')).toBe(true);
    expect(isGmailApprovalTool('gmail_reply')).toBe(true);
    expect(isGmailApprovalTool('gmail_forward')).toBe(true);
    expect(isGmailApprovalTool('gmail_send_draft')).toBe(true);
    expect(isGmailApprovalTool('gmail_batch_mark_read')).toBe(false);
  });

  it('builds an awaiting-approval tool result that tells the model not to claim sent', () => {
    const payload = JSON.parse(
      awaitingApprovalToolResult({
        tool: 'gmail_send',
        to: 'boss@example.com',
        subject: 'Leave',
        body: 'I need a day off.',
      }),
    );
    expect(payload.status).toBe('awaiting_user_approval');
    expect(String(payload.message)).toMatch(/NOT sent/i);
  });

  it('executes an approved gmail_send draft', async () => {
    const { gmailSendMessage } = await import('@/lib/integrations/google/gmail');
    await executeApprovedGmailDraft('tok', {
      tool: 'gmail_send',
      to: 'boss@example.com',
      subject: 'Leave',
      body: 'I need a day off.',
      cc: 'hr@example.com',
    });
    expect(gmailSendMessage).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({
        to: 'boss@example.com',
        subject: 'Leave',
        cc: 'hr@example.com',
      }),
    );
  });
});
