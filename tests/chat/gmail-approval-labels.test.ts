import { describe, expect, it } from 'vitest';
import { normalizeEscapedNewlines } from '@/lib/markdown/core/breaks';
import { getGmailApprovalLabelKey } from '@/lib/chat/message/tool-classify';

describe('normalizeEscapedNewlines', () => {
  it('turns literal backslash-n into <br> for table cells', () => {
    expect(normalizeEscapedNewlines('你好！\\n\\n这是测试')).toBe('你好！<br><br>这是测试');
  });

  it('leaves real newlines alone', () => {
    expect(normalizeEscapedNewlines('a\nb')).toBe('a\nb');
  });
});

describe('getGmailApprovalLabelKey', () => {
  it('picks per-tool awaiting / sent / cancelled labels', () => {
    expect(getGmailApprovalLabelKey('gmail_send', 'awaiting')).toBe('emailAwaitingSend');
    expect(getGmailApprovalLabelKey('gmail_reply', 'awaiting')).toBe('emailAwaitingReply');
    expect(getGmailApprovalLabelKey('gmail_forward', 'sent')).toBe('emailForwardSent');
    expect(getGmailApprovalLabelKey('gmail_send_draft', 'cancelled')).toBe(
      'emailDraftCancelled',
    );
  });
});
