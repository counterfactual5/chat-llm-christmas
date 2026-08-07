import { describe, expect, it } from 'vitest';
import {
  assembleUserContent,
  cleanBaseMessagesForSend,
  hasUploadingAttachments,
  messageImagesFromAttachments,
  resolvePendingAttachments,
  titleForNewConversation,
} from '@/lib/chat/turn/attachments';
import { uploadFailurePatch } from '@/lib/chat/turn/upload-patch';
import {
  exceedsUsableWindow,
  estimateTokensForSend,
  shouldCompactBeforeSend,
} from '@/lib/chat/turn/send-estimate';
import {
  applyAssistantStreamFailure,
  applyGeneratedImageToAssistant,
  applyImageGenerationError,
  isAbortError,
  mapAssistantById,
  patchAssistantAfterStreamFailure,
} from '@/lib/chat/turn/stream-error';
import {
  EMPTY_AFTER_PROCESS_PROMPT,
  buildResumeStreamPlan,
  clearedEmptyAssistant,
} from '@/lib/chat/turn/continuation';
import type { Message } from '@/lib/chat/types';
import type { IngestedAttachment } from '@/lib/files/ingest';

function msg(partial: Partial<Message> & Pick<Message, 'role' | 'content'>): Message {
  return {
    id: partial.id || 'm',
    role: partial.role,
    content: partial.content,
    timestamp: partial.timestamp ?? 1,
    incomplete: partial.incomplete,
    reasoning: partial.reasoning,
    images: partial.images,
    toolRuns: partial.toolRuns,
    activity: partial.activity,
  };
}

function att(partial: Partial<IngestedAttachment> & Pick<IngestedAttachment, 'id' | 'name'>): IngestedAttachment {
  return {
    id: partial.id,
    name: partial.name,
    type: partial.type || 'text/plain',
    size: partial.size ?? 1,
    text: partial.text,
    dataUrl: partial.dataUrl,
    fileId: partial.fileId,
    uploading: partial.uploading,
    uploadError: partial.uploadError,
  };
}

describe('attachments', () => {
  it('drops only a trailing empty incomplete assistant', () => {
    const history = [
      msg({ id: 'u', role: 'user', content: 'hi' }),
      msg({ id: 'a', role: 'assistant', content: '', incomplete: true }),
    ];
    expect(cleanBaseMessagesForSend(history).map((m) => m.id)).toEqual(['u']);
  });

  it('embeds text files and maps image urls', () => {
    expect(
      assembleUserContent('please summarize', [
        att({ id: '1', name: 'a.txt', text: ' alpha ' }),
      ]),
    ).toBe('[Attached File: a.txt]\nalpha\n\n---\n\nplease summarize');

    expect(
      assembleUserContent('summarize', [
        att({ id: '1b', name: 'a.pdf', type: 'application/pdf', text: 'pdf body', fileId: 'fid/pdf' }),
      ]),
    ).toBe(
      '[Attached File: a.pdf] (stored fileId: fid/pdf)\npdf body\n\n---\n\nsummarize',
    );

    expect(
      messageImagesFromAttachments([
        att({ id: '2', name: 'x.png', type: 'image/png', fileId: 'fid/1' }),
      ])[0].url,
    ).toBe('/api/files/fid%2F1');
  });

  it('embeds a file_read pointer for fileId-only docs (post-U4a server extract)', () => {
    // pdf/docx/epub/xlsx no longer carry client-side text — the body must be a
    // pointer to the server-side sidecar, not empty/missing content.
    expect(
      assembleUserContent(
        'summarize this report',
        [],
        [att({ id: 'd', name: 'report.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileId: 'file-doc-1' })],
      ),
    ).toBe(
      '[Attached File: report.docx] (stored fileId: file-doc-1)\n' +
        '(content is stored server-side in the extract sidecar; to inspect it, call file_read with file_id=file-doc-1)\n\n---\n\nsummarize this report',
    );

    // Mixed: text-bearing attachments inline; fileId-only docs point.
    expect(
      assembleUserContent(
        'hi',
        [att({ id: 't', name: 'notes.txt', text: 'inline body' })],
        [att({ id: 'p', name: 'paper.pdf', type: 'application/pdf', fileId: 'file-pdf-9' })],
      ),
    ).toBe(
      '[Attached File: notes.txt]\ninline body\n\n' +
        '[Attached File: paper.pdf] (stored fileId: file-pdf-9)\n' +
        '(content is stored server-side in the extract sidecar; to inspect it, call file_read with file_id=file-pdf-9)\n\n---\n\nhi',
    );

    // Default third arg keeps the prior two-arg signature working.
    expect(assembleUserContent('plain', [])).toBe('plain');
  });

  it('treats a fileId-only doc attachment as sendable (not empty) without vision', () => {
    const doc = att({
      id: 'd1',
      name: 'report.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileId: 'file-doc-1',
    });
    const resolved = resolvePendingAttachments({
      textToSend: '',
      attachments: [doc],
      isActiveSession: true,
      vision: false,
      zhipuVisionOn: false,
      isLoading: false,
    });
    expect(resolved).toMatchObject({
      ok: true,
      pendingTexts: [],
      pendingDocRefs: [expect.objectContaining({ id: 'd1' })],
    });
    if (resolved.ok) {
      expect(resolved.fullContent).toContain('[Attached File: report.docx] (stored fileId: file-doc-1)');
      expect(resolved.fullContent).toContain('file_read with file_id=file-doc-1');
    }
  });

  it('hard-blocks send when a text-less doc failed to upload (no sidecar to read)', () => {
    expect(
      resolvePendingAttachments({
        textToSend: 'hi',
        attachments: [
          att({ id: 'd2', name: 'x.pdf', type: 'application/pdf', uploadError: true }),
        ],
        isActiveSession: true,
        vision: false,
        zhipuVisionOn: false,
        isLoading: false,
      }),
    ).toEqual({ ok: false, error: 'upload_failed' });
  });

  it('does not treat uploaded PDFs as vision images', () => {
    const pdf = att({
      id: 'p',
      name: 'doc.pdf',
      type: 'application/pdf',
      text: 'hello',
      fileId: 'fid/pdf',
    });
    const resolved = resolvePendingAttachments({
      textToSend: 'hi',
      attachments: [pdf],
      isActiveSession: true,
      vision: false,
      zhipuVisionOn: false,
      isLoading: false,
    });
    expect(resolved).toMatchObject({
      ok: true,
      pendingImages: [],
      pendingTexts: [expect.objectContaining({ id: 'p' })],
    });
  });

  it('gates vision / upload / empty sends', () => {
    const image = att({
      id: '2',
      name: 'x.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,aa',
    });
    expect(
      resolvePendingAttachments({
        textToSend: '',
        attachments: [image],
        isActiveSession: true,
        vision: false,
        zhipuVisionOn: false,
        isLoading: false,
      }).ok,
    ).toBe(false);

    expect(
      resolvePendingAttachments({
        textToSend: '',
        attachments: [image],
        isActiveSession: true,
        vision: false,
        zhipuVisionOn: true,
        isLoading: false,
      }),
    ).toMatchObject({ ok: true });

    expect(hasUploadingAttachments([{ uploading: true }])).toBe(true);
    expect(hasUploadingAttachments([{ uploading: false }, { uploading: true }])).toBe(true);
    expect(hasUploadingAttachments([{ uploading: false }])).toBe(false);
    expect(hasUploadingAttachments([])).toBe(false);

    expect(
      resolvePendingAttachments({
        textToSend: 'hi',
        attachments: [att({ id: 'u', name: 'x.png', type: 'image/png', dataUrl: 'd', uploading: true })],
        isActiveSession: true,
        vision: true,
        zhipuVisionOn: false,
        isLoading: false,
      }),
    ).toEqual({ ok: false, error: 'upload_in_progress' });

    expect(
      resolvePendingAttachments({
        textToSend: '',
        attachments: [],
        isActiveSession: true,
        vision: true,
        zhipuVisionOn: false,
        isLoading: false,
      }),
    ).toEqual({ ok: false, error: 'empty' });
  });

  it('derives titles with the historical ellipsis rule', () => {
    expect(titleForNewConversation('short')).toBe('short');
    expect(titleForNewConversation('x'.repeat(35))).toBe(`${'x'.repeat(30)}...`);
    expect(titleForNewConversation('', [att({ id: '1', name: 'photo.png' })])).toBe('photo.png');
  });
});

describe('uploadFailurePatch (upload soft-fail hard-gate)', () => {
  it('hard-fails text-less non-image attachments (the P1 regression)', () => {
    // Pre-fix: this branch always set uploadError: false, silencing the send gate.
    const patch = uploadFailurePatch({
      isImage: false,
      text: undefined,
      msg: 'connection reset',
    });
    expect(patch.uploading).toBe(false);
    expect(patch.uploadError).toBe(true);
    expect(patch.uploadErrorMessage).toBe('connection reset');
  });

  it('soft-fails text-bearing non-image attachments (plain-text preserve)', () => {
    const patch = uploadFailurePatch({
      isImage: false,
      text: 'pdf body extracted',
      msg: 'connection reset',
    });
    expect(patch.uploading).toBe(false);
    expect(patch.uploadError).toBe(false);
    expect(patch.uploadErrorMessage).toBeUndefined();
  });

  it('hard-fails image attachments regardless of text', () => {
    const patch = uploadFailurePatch({
      isImage: true,
      text: undefined,
      msg: 'too large',
    });
    expect(patch.uploading).toBe(false);
    expect(patch.uploadError).toBe(true);
    expect(patch.uploadErrorMessage).toBe('too large');
  });

  it('keeps the resolvePendingAttachments send gate aligned with the new flag', () => {
    // Sanity: a text-less non-image doc with uploadError: true must now block send.
    const doc = att({
      id: 'd1',
      name: 'a.pdf',
      type: 'application/pdf',
      uploadError: true,
    });
    const resolved = resolvePendingAttachments({
      textToSend: 'hi',
      attachments: [doc],
      isActiveSession: true,
      vision: false,
      zhipuVisionOn: false,
      isLoading: false,
    });
    expect(resolved).toEqual({ ok: false, error: 'upload_failed' });

    // An image with uploadError also blocks.
    const image = att({
      id: 'i1',
      name: 'x.png',
      type: 'image/png',
      uploadError: true,
    });
    const resolvedImg = resolvePendingAttachments({
      textToSend: 'hi',
      attachments: [image],
      isActiveSession: true,
      vision: true,
      zhipuVisionOn: false,
      isLoading: false,
    });
    expect(resolvedImg).toEqual({ ok: false, error: 'upload_failed' });
  });
});

describe('send-estimate', () => {
  it('sums system overheads and history (skills folded into system)', () => {
    const projected = estimateTokensForSend({
      history: [msg({ role: 'user', content: 'hello world' })],
      nextUserText: 'next',
      pendingImageCount: 1,
      contextBreakdown: { system: 10, skills: 5 },
    });
    // skills are ignored — already inside isomorphic system
    expect(projected).toBeGreaterThan(10 + 1000);
    expect(projected).toBeLessThan(10 + 5 + 1000 + 500);
    expect(shouldCompactBeforeSend(91, 100)).toBe(true);
    expect(shouldCompactBeforeSend(90, 100)).toBe(false);
    expect(exceedsUsableWindow(101, 100)).toBe(true);
  });
});

describe('stream-error', () => {
  it('keeps partial stream text as incomplete', () => {
    const kept = patchAssistantAfterStreamFailure(msg({ role: 'assistant', content: 'half' }), 'boom');
    expect(kept.content).toBe('half');
    expect(kept.incomplete).toBe(true);
    expect(kept.truncationReason).toBe('boom');

    const empty = applyAssistantStreamFailure(
      [msg({ id: 'a', role: 'assistant', content: '' })],
      'a',
      'boom',
    )[0];
    expect(empty.content).toBe('Error: boom');
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
  });

  it('patches generated image success and failure', () => {
    const base = msg({
      id: 'a',
      role: 'assistant',
      content: '',
      incomplete: true,
    });
    const ok = applyGeneratedImageToAssistant(base, {
      imageUrl: 'data:image/png;base64,xx',
      prompt: 'cat',
      fileId: 'f1',
    });
    expect(ok.content).toBe('');
    expect(ok.images?.[0]?.prompt).toBe('cat');

    const fail = applyImageGenerationError(base, 'nope');
    expect(fail.content).toBe('Error: nope');

    const mapped = mapAssistantById(
      [base, msg({ id: 'b', role: 'user', content: 'x' })],
      'a',
      (m) => applyImageGenerationError(m, 'x'),
    );
    expect(mapped[0].content).toBe('Error: x');
  });
});

describe('buildResumeStreamPlan', () => {
  it('plans reanswer_empty / answer_after_process / continue', () => {
    const user = msg({ id: 'u', role: 'user', content: 'what is 2+2?' });
    const empty = msg({ id: 'a', role: 'assistant', content: '', incomplete: true });
    expect(
      buildResumeStreamPlan({ last: empty, lastUser: user, emptyInterrupted: true }).kind,
    ).toBe('reanswer_empty');

    const withThought = msg({
      id: 'a',
      role: 'assistant',
      content: '',
      incomplete: true,
      reasoning: 'thinking',
    });
    const afterProcess = buildResumeStreamPlan({
      last: withThought,
      lastUser: user,
      emptyInterrupted: true,
    });
    expect(afterProcess.kind).toBe('answer_after_process');
    if (afterProcess.kind === 'answer_after_process') {
      expect(afterProcess.extraUserContent).toBe(EMPTY_AFTER_PROCESS_PROMPT);
    }

    const partial = msg({
      id: 'a',
      role: 'assistant',
      content: 'The answer is',
      incomplete: true,
    });
    const cont = buildResumeStreamPlan({
      last: partial,
      lastUser: user,
      emptyInterrupted: false,
    });
    expect(cont.kind).toBe('continue');
    if (cont.kind === 'continue') {
      expect(cont.initialContent).toBe('The answer is');
      expect(cont.extraUserContent.length).toBeGreaterThan(0);
    }

    expect(clearedEmptyAssistant(withThought).reasoning).toBeUndefined();
  });
});
