import { describe, expect, it } from 'vitest';
import {
  looksLikeProseEscapedBreaks,
  normalizeEscapedNewlines,
} from '@/lib/markdown/core/breaks';
import { getGmailApprovalLabelKey } from '@/lib/chat/message/tool-classify';

describe('normalizeEscapedNewlines', () => {
  it('expands prose/email bodies that use \\n as linebreak placeholders', () => {
    expect(normalizeEscapedNewlines('你好！\\n\\n这是测试\\nAI 助手')).toBe(
      '你好！<br><br>这是测试<br>AI 助手',
    );
    expect(looksLikeProseEscapedBreaks('你好！\\n\\n这是测试')).toBe(true);
  });

  it('leaves literal escape documentation alone', () => {
    expect(normalizeEscapedNewlines('use \\n for newline')).toBe('use \\n for newline');
    expect(normalizeEscapedNewlines('\\n')).toBe('\\n');
    expect(looksLikeProseEscapedBreaks('use \\n for newline')).toBe(false);
  });

  it('does not treat Windows paths as prose breaks', () => {
    expect(normalizeEscapedNewlines('C:\\new\\folder')).toBe('C:\\new\\folder');
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
