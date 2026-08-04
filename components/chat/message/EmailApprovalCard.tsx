'use client';

import { useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { useLocale, type MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { GmailApprovalDraft } from '@/lib/mcp/google/gmail-approval';

export type EmailApprovalCardProps = {
  draft: GmailApprovalDraft;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
  onSend: (draft: GmailApprovalDraft) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
};

function approvalTitleKey(tool: GmailApprovalDraft['tool']): MessageKey {
  if (tool === 'gmail_reply') return 'emailAwaitingReply';
  if (tool === 'gmail_forward') return 'emailAwaitingForward';
  if (tool === 'gmail_send_draft') return 'emailAwaitingSendDraft';
  return 'emailAwaitingSend';
}

export function EmailApprovalCard({
  draft,
  busy = false,
  disabled = false,
  error,
  onSend,
  onCancel,
}: EmailApprovalCardProps) {
  const { t } = useLocale();
  const [to, setTo] = useState(draft.to || '');
  const [cc, setCc] = useState(draft.cc || '');
  const [bcc, setBcc] = useState(draft.bcc || '');
  const [subject, setSubject] = useState(draft.subject || '');
  const [body, setBody] = useState(draft.body || '');
  // Only show Cc/Bcc when the draft already has them (or the user filled them).
  const [showCc] = useState(Boolean(String(draft.cc || '').trim()));
  const [showBcc] = useState(Boolean(String(draft.bcc || '').trim()));

  const locked = busy || disabled;

  return (
    <div
      className={cn(
        'mt-2 rounded-xl border border-border/70 bg-background/80 p-3 shadow-sm',
        'space-y-2.5',
      )}
    >
      <div className="text-xs font-medium text-muted-foreground">
        {t(approvalTitleKey(draft.tool))}
      </div>
      <label className="block space-y-1">
        <span className="text-[11px] text-muted-foreground">{t('emailTo')}</span>
        <input
          type="text"
          value={to}
          disabled={locked}
          onChange={(e) => setTo(e.target.value)}
          className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm outline-none focus:border-foreground/30"
        />
      </label>
      {showCc ? (
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">{t('emailCc')}</span>
          <input
            type="text"
            value={cc}
            disabled={locked}
            onChange={(e) => setCc(e.target.value)}
            className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm outline-none focus:border-foreground/30"
          />
        </label>
      ) : null}
      {showBcc ? (
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">{t('emailBcc')}</span>
          <input
            type="text"
            value={bcc}
            disabled={locked}
            onChange={(e) => setBcc(e.target.value)}
            className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm outline-none focus:border-foreground/30"
          />
        </label>
      ) : null}
      <label className="block space-y-1">
        <span className="text-[11px] text-muted-foreground">{t('emailSubject')}</span>
        <input
          type="text"
          value={subject}
          disabled={locked}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm outline-none focus:border-foreground/30"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-muted-foreground">{t('emailBody')}</span>
        <textarea
          value={body}
          disabled={locked}
          rows={8}
          onChange={(e) => setBody(e.target.value)}
          className="w-full resize-y rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm outline-none focus:border-foreground/30 min-h-[120px]"
        />
      </label>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          disabled={locked}
          onClick={() => void onCancel()}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/60 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          {t('emailCancel')}
        </button>
        <button
          type="button"
          disabled={locked || !to.trim() || !subject.trim() || !body.trim()}
          onClick={() =>
            void onSend({
              ...draft,
              to: to.trim(),
              cc: cc.trim() || undefined,
              bcc: bcc.trim() || undefined,
              subject: subject.trim(),
              body,
            })
          }
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t('emailSend')}
        </button>
      </div>
    </div>
  );
}
