'use client';

import type { ClipboardEvent, KeyboardEvent, RefObject, MutableRefObject } from 'react';
import {
  Loader2,
  RefreshCw,
  Sparkles,
  ChevronDown,
  FileText,
  FilePlus,
  FileSearch,
  ScrollText,
  Image as ImageIcon,
  Globe,
  ShieldCheck,
  ListTree,
  PenLine,
  Layers,
  BookOpen,
  GraduationCap,
  X,
  Download,
} from 'lucide-react';
import { BrandMark } from '@/components/branding/BrandMark';
import { NotionLogo } from '@/components/integrations/logos/NotionLogo';
import { GitHubLogo } from '@/components/integrations/logos/GitHubLogo';
import { GoogleLogo } from '@/components/integrations/logos/GoogleLogo';
import { Textarea } from '@/components/ui/textarea';
import {
  AttachmentImageThumb,
  isImageAttachment,
} from '@/components/files/AttachmentImageThumb';
import { canPreviewGeneratedFile, formatPreviewTypeLabel } from '@/lib/files/preview';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { IngestedAttachment } from '@/lib/files/ingest';
import type { Message } from '@/lib/chat/types';
import { displayAssistantParts } from '@/lib/chat/message/display';
import {
  buildActivitySteps,
  buildTimelineSegments,
  findLastContentSegmentId,
  type ProcessStep,
  type TimelineSegment,
  type ToolStep,
} from '@/lib/chat/message/timeline';
import { classifyToolRun, getToolRunLabelKey, toolRunShowsFetchingResults } from '@/lib/chat/message/tool-classify';
import { getReviewCheckTitleKey } from '@/lib/chat/message/review-labels';
import { getReviewCheckIcon } from './helpers/review-check-icon';
import { ReasoningBodyScroll } from '@/components/chat/message/ReasoningBodyScroll';
import { AnswerMarkdown } from '@/components/chat/message/AnswerMarkdown';
import { QuoteMarkdown } from '@/components/chat/message/QuoteMarkdown';
import { EmailApprovalCard } from '@/components/chat/message/EmailApprovalCard';
import { MemorySavedNotice } from '@/components/memories/MemorySavedNotice';
import type { GmailApprovalDraft } from '@/lib/mcp/google/gmail-approval';
import { stripUserMessageArtifactsForDisplay } from '@/lib/tools/image-understand/persist';
import { attachedFilesForUserBubbleDisplay } from '@/lib/files/attached-file-blocks';
import {
  formatFileSize,
  type GeneratedFileEntry,
  type GeneratedImageEntry,
} from '../panels/OutputPanel';
import type { ToolViewPayload } from '@/lib/tools/views/types';

import type { ReviewCheckKind } from '@/lib/tools/review/claim-reviewer';

export type ChatMessageListProps = {
  messages: Message[];
  selectedModel: string;
  isActiveLoading: boolean;
  lastMessage: Message | undefined;
  replyWaitByMessage: Record<string, boolean>;
  scrollRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
  handleMessagesScroll: () => void;
  handleSubmit: (hint: string) => void;

  editingMessageId: string | null;
  editingMessageContent: string;
  setEditingMessageContent: (v: string | ((prev: string) => string)) => void;
  editingMessageAttachments: IngestedAttachment[];
  handleEditMessageKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>, messageId: string) => void;
  onPasteEditFiles: (e: ClipboardEvent) => void;
  bindImeGuards: (
    composingRef: MutableRefObject<boolean>,
    enterLockRef: MutableRefObject<boolean>,
  ) => Record<string, unknown>;
  editImeComposingRef: MutableRefObject<boolean>;
  editImeEnterLockRef: MutableRefObject<boolean>;
  addEditIngestedFiles: (files: FileList | File[]) => void;
  removeEditingMessageAttachment: (id: string) => void;
  setImagePreviewSrc: (src: string | null) => void;
  onPreviewImage: (entry: GeneratedImageEntry) => void;
  onPreviewFile: (entry: GeneratedFileEntry) => void;
  onPreviewView: (view: ToolViewPayload, messageId: string) => void;
  onGmailApproval?: (
    messageId: string,
    toolRunId: string,
    action: 'send' | 'cancel',
    draft: GmailApprovalDraft,
  ) => void | Promise<void>;
  gmailApprovalBusyId?: string | null;
  gmailApprovalError?: string | null;
  cancelEditMessage: () => void;
  saveEditedMessage: (messageId: string) => void;
  editUserMessage: (messageId: string) => void;
  parseQuotedUserMessage: (content: string) => { quotes: string[]; body: string };

  reasoningOpen: Record<string, boolean>;
  setReasoningOpen: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  toolRunOpen: Record<string, boolean>;
  setToolRunOpen: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  downloadGeneratedFile: (entry: {
    messageId: string;
    fileIndex: number;
    id: string;
    name: string;
    mimeType: string;
    size: number;
    url: string;
    content?: string;
    createdAt: number;
  }) => void | Promise<void>;
  canRetryFailed: boolean;
  retryFailedReply: () => void;
  isAssistantError: (m?: Message) => boolean;
  /** Account-memory toast after auto-extract — shown under Review on the latest assistant turn. */
  memorySavedNotice?: { count: number } | null;
  onViewMemorySaved?: () => void;
  onDismissMemorySaved?: () => void;
};

export function ChatMessageList(props: ChatMessageListProps) {
  const { t } = useLocale();
  const {
    messages,
    selectedModel,
    isActiveLoading,
    lastMessage,
    replyWaitByMessage,
    scrollRef,
    messagesContentRef,
    handleMessagesScroll,
    handleSubmit,
    editingMessageId,
    editingMessageContent,
    setEditingMessageContent,
    editingMessageAttachments,
    handleEditMessageKeyDown,
    onPasteEditFiles,
    bindImeGuards,
    editImeComposingRef,
    editImeEnterLockRef,
    addEditIngestedFiles,
    removeEditingMessageAttachment,
    setImagePreviewSrc,
    onPreviewImage,
    onPreviewFile,
    onPreviewView,
    onGmailApproval,
    gmailApprovalBusyId,
    gmailApprovalError,
    cancelEditMessage,
    saveEditedMessage,
    editUserMessage,
    parseQuotedUserMessage,
    reasoningOpen,
    setReasoningOpen,
    toolRunOpen,
    setToolRunOpen,
    downloadGeneratedFile,
    canRetryFailed,
    retryFailedReply,
    isAssistantError,
    memorySavedNotice,
    onViewMemorySaved,
    onDismissMemorySaved,
  } = props;

  return (
    <>
    {/* Messages List */}
    <div
      className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
      ref={scrollRef}
      onScroll={handleMessagesScroll}
    >
    <div ref={messagesContentRef} className="mx-auto w-full min-w-0 max-w-[960px] px-5 py-8 md:px-8 lg:px-10">
    {messages.length === 0 ? (
      <div className="mt-16 flex flex-col items-center text-center">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm">
          <BrandMark className="h-14 w-14" />
        </div>
        <h2 className="mb-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
          {t('heroTitle')}
        </h2>
        <p className="text-stone-500 max-w-md text-sm">
          {t('heroSubtitle')}
        </p>

        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 w-full max-w-2xl mx-auto">
          {[
            t('starter1'),
            t('starter2'),
            t('starter3'),
            t('starter4'),
          ].map(hint => (
            <button
              key={hint}
              onClick={() => handleSubmit(hint)}
              className="rounded-xl border border-stone-200/80 bg-white p-4 text-left text-sm text-stone-700 transition-all hover:border-stone-400 hover:shadow-md dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600"
            >
              <div className="font-medium">{hint}</div>
              <div className="mt-1 text-xs text-stone-400">{t('clickToAsk')}</div>
            </button>
          ))}
        </div>
      </div>
    ) : (
      <div className="space-y-8 pb-20">
        {messages.map((message) =>
          message.compacted ? (
            <div
              key={message.id}
              className="flex w-full items-center gap-3 py-1.5 text-amber-700 dark:text-amber-300"
              title={t('compactedTooltip')}
            >
              <div className="h-px flex-1 bg-amber-200/80 dark:bg-amber-900/60" />
              <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider dark:border-amber-900/60 dark:bg-amber-950/40">
                <Sparkles className="h-3 w-3" />
                {t('compacted')}
              </div>
              <div className="h-px flex-1 bg-amber-200/80 dark:bg-amber-900/60" />
            </div>
          ) : message.role === 'user' ? (
            <div
              id={`message-${message.id}`}
              key={message.id}
              className="group flex w-full scroll-mt-8 justify-end transition-colors"
            >
              <div className="max-w-[82%] sm:max-w-[72%]">
                {editingMessageId === message.id ? (
                  <div
                    className="rounded-2xl border border-stone-300 bg-white p-3 shadow-sm dark:border-stone-700 dark:bg-stone-900 w-full min-w-[min(100%,20rem)]"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer.files?.length) {
                        void addEditIngestedFiles(e.dataTransfer.files);
                      }
                    }}
                  >
                    {editingMessageAttachments.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {editingMessageAttachments.map((a) =>
                          isImageAttachment(a) ? (
                            <AttachmentImageThumb
                              key={a.id}
                              attachment={a}
                              variant="free"
                              onPreview={setImagePreviewSrc}
                              onRemove={() => removeEditingMessageAttachment(a.id)}
                            />
                          ) : (
                            <div
                              key={a.id}
                              className={cn(
                                'group flex max-w-full items-center gap-2 rounded-xl border bg-white px-2 py-1.5 text-xs shadow-sm dark:bg-stone-900',
                                a.uploading
                                  ? 'border-stone-300 opacity-80 dark:border-stone-600'
                                  : 'border-stone-200 dark:border-stone-700',
                              )}
                              title={a.uploading ? 'Uploading…' : a.name}
                            >
                              {a.uploading ? (
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-stone-400" />
                              ) : (
                                <FileText className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                              )}
                              <span className="truncate text-stone-600 dark:text-stone-300">
                                {a.name}
                              </span>
                              {a.fileId && !a.uploading && (
                                <span className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400">
                                  ✓
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => removeEditingMessageAttachment(a.id)}
                                className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-red-500 dark:hover:bg-stone-800"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                    <Textarea
                      value={editingMessageContent}
                      onChange={(event) => setEditingMessageContent(event.target.value)}
                      onKeyDown={(e) => handleEditMessageKeyDown(e, message.id)}
                      onPaste={onPasteEditFiles}
                      placeholder={t('writeMessage', {
                        model: selectedModel || 'AI',
                      })}
                      {...bindImeGuards(editImeComposingRef, editImeEnterLockRef)}
                      className="min-h-[40px] max-h-[400px] w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-7 focus-visible:ring-0"
                      style={{ height: 'auto' }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = Math.min(target.scrollHeight, 400) + 'px';
                      }}
                      autoFocus
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEditMessage}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEditedMessage(message.id)}
                        disabled={
                          editingMessageAttachments.some((a) => a.uploading) ||
                          (!editingMessageContent.trim() &&
                            !editingMessageAttachments.some(
                              (a) =>
                                a.text ||
                                (isImageAttachment(a) && (a.dataUrl || a.fileId)),
                            ))
                        }
                        title={
                          editingMessageAttachments.some((a) => a.uploading)
                            ? t('waitForUpload')
                            : undefined
                        }
                        className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                      >
                        Save & resend
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {(() => {
                      const { quotes, body } = parseQuotedUserMessage(
                        message.content && message.content !== '(image)'
                          ? attachedFilesForUserBubbleDisplay(
                              stripUserMessageArtifactsForDisplay(message.content),
                            )
                          : '',
                      );
                      return (
                        <div className="overflow-hidden rounded-2xl rounded-br-md bg-stone-200/80 text-[15px] leading-7 text-stone-900 dark:bg-stone-800 dark:text-stone-100">
                          {quotes.length > 0 ? (
                            <div className="mx-3.5 mt-2.5 mb-0 space-y-1">
                              {quotes.map((quote, qi) => (
                                <blockquote
                                  key={qi}
                                  className="border-l-2 border-stone-400/70 py-0 pl-2.5 dark:border-stone-500"
                                >
                                  <QuoteMarkdown text={quote} />
                                </blockquote>
                              ))}
                            </div>
                          ) : null}
                          {(body || (message.images && message.images.length > 0)) && (
                          <div className={cn('px-4 py-2.5 whitespace-pre-wrap', quotes.length > 0 && 'pt-1.5')}>
                            {message.images && message.images.length > 0 && (
                              <div className={cn('flex flex-wrap gap-2', body && 'mb-2')}>
                                {message.images.map((img, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setImagePreviewSrc(img.url)}
                                    className="cursor-zoom-in overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60"
                                  >
                                    <img
                                      src={img.url}
                                      alt={img.name || 'attachment'}
                                      className="max-h-48 max-w-full rounded-lg object-contain"
                                    />
                                  </button>
                                ))}
                              </div>
                            )}
                            {body || null}
                          </div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="mt-1 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => editUserMessage(message.id)}
                        className="rounded-md px-2 py-1 text-[11px] text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
                      >
                        Edit
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div
              id={`message-${message.id}`}
              key={message.id}
              className="w-full min-w-0 max-w-full scroll-mt-8 space-y-3 pr-8 sm:pr-16"
            >
              {(() => {
                const parts = displayAssistantParts(message);
                const visibleContent = parts.content;
                const visibleReasoning = parts.reasoning;
                const toolById = new Map(
                  (message.toolRuns || []).map((run) => [run.id, run]),
                );
                const activitySteps = buildActivitySteps(
                  message,
                  visibleReasoning,
                  toolById,
                );
                const messageIsStreaming =
                  isActiveLoading && message.id === lastMessage?.id;
                const awaitingFirstContent = Boolean(
                  message.incomplete && !visibleContent && messageIsStreaming,
                );
                const replyWait = Boolean(
                  messageIsStreaming &&
                    message.incomplete &&
                    replyWaitByMessage[message.id],
                );
                const timelineSegments = buildTimelineSegments({
                  messageId: message.id,
                  activitySteps,
                  toolById,
                  visibleContent,
                  messageIsStreaming,
                  awaitingFirstContent,
                  replyWait,
                });
                const renderToolStep = (step: ToolStep) => {
                  const run = toolById.get(step.toolRunId);
                  if (!run) return null;
                  const classification = classifyToolRun(run);
                  const {
                    isNotion,
                    isNotionFetch,
                    isGitHub,
                    isGoogle,
                    isImageUnderstand,
                    isPaperSearch,
                    isBookSearch,
                    isBookDownload,
                    isPaperDownload,
                    isGenerateImage,
                    isCreateFile,
                    isFileRead,
                    isDocxExtract,
                    isXlsxExtract,
                    isSaveSkill,
                    isClaimReviewer,
                    isReviewAudit,
                    isReviewVerifier,
                    isReviewReport,
                    isWebRead,
                    isResearchPlan,
                    isResearchSynthesize,
                    isResearchVerify,
                    isResearchWrite,
                    isResearchSources,
                    isPaperRead,
                  } = classification;
                  if (isClaimReviewer) return null;
                  const failed = run.status === 'done' && Boolean(run.error);
                  const emptyResults =
                    run.status === 'done' &&
                    !run.error &&
                    (!run.results || run.results.length === 0);
                  // Only spin while this session is actually streaming —
                  // orphan status:"start" after refresh must not look live.
                  const searching =
                    run.status === 'start' &&
                    isActiveLoading &&
                    message.id === lastMessage?.id;
                  const resultCount = run.results?.length || 0;
                  // Expand only while in flight; auto-collapse when done
                  // so Process doesn't bury the answer. Explicit toggles win.
                  // Keep approval cards expanded so the compose form stays visible.
                  const expanded =
                    toolRunOpen[run.id] ??
                    (searching || run.status === 'awaiting_approval');
                  const label = t(
                    getToolRunLabelKey(classification, {
                      searching,
                      failed,
                      awaitingApproval: run.status === 'awaiting_approval',
                      approvalOutcome: run.approvalOutcome,
                      toolName: run.name,
                    }),
                  );
                  const showQueryInline =
                    Boolean(run.query) &&
                    (isNotion ||
                      isGoogle ||
                      isCreateFile ||
                      isFileRead ||
                      isDocxExtract ||
                      isXlsxExtract ||
                      isSaveSkill ||
                      isWebRead ||
                      isPaperRead ||
                      isResearchPlan ||
                      isResearchSynthesize ||
                      isResearchVerify ||
                      isResearchWrite ||
                      isReviewAudit ||
                      isReviewVerifier ||
                      isReviewReport ||
                      (!isNotion &&
                        !isGitHub &&
                        !isGoogle &&
                        !isImageUnderstand &&
                        !isCreateFile &&
                        !isFileRead &&
                        !isDocxExtract &&
                        !isXlsxExtract &&
                        !isSaveSkill &&
                        !isClaimReviewer));
                  return (
                    <div key={step.id} className="overflow-hidden">
                      <button
                        type="button"
                        onClick={() =>
                          setToolRunOpen((prev) => ({
                            ...prev,
                            [run.id]: !(
                              prev[run.id] ??
                              (searching || run.status === 'awaiting_approval')
                            ),
                          }))
                        }
                        className={cn(
                          'flex w-full items-center gap-1.5 py-0.5 text-left text-[12px] leading-5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300',
                          failed &&
                            'text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300',
                        )}
                      >
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 shrink-0 opacity-60 transition-transform',
                            expanded ? 'rotate-0' : '-rotate-90',
                          )}
                        />
                        {searching ? (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-stone-500 dark:text-stone-400" />
                        ) : isResearchPlan ? (
                          <ListTree className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isResearchSynthesize ? (
                          <Layers className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isResearchVerify ? (
                          <ShieldCheck className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isResearchWrite ? (
                          <PenLine className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isResearchSources ? (
                          <Globe className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isClaimReviewer ? (
                          <ShieldCheck className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isReviewAudit || isReviewVerifier ? (
                          <ShieldCheck className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isReviewReport ? (
                          <PenLine className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isNotion ? (
                          <NotionLogo className="h-3 w-3 shrink-0" />
                        ) : isGitHub ? (
                          <GitHubLogo className="h-3 w-3 shrink-0" />
                        ) : isGoogle ? (
                          <GoogleLogo className="h-3 w-3 shrink-0" />
                        ) : isPaperSearch || isPaperDownload ? (
                          <GraduationCap className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isBookSearch || isBookDownload ? (
                          <BookOpen className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isGenerateImage || isImageUnderstand ? (
                          <ImageIcon className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isCreateFile ? (
                          <FilePlus className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isFileRead ? (
                          <FileSearch className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isDocxExtract || isXlsxExtract ? (
                          <Layers className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isSaveSkill ? (
                          <ScrollText className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isWebRead ? (
                          <BookOpen className="h-3 w-3 shrink-0 opacity-60" />
                        ) : isPaperRead ? (
                          <GraduationCap className="h-3 w-3 shrink-0 opacity-60" />
                        ) : (
                          <Globe className="h-3 w-3 shrink-0 opacity-60" />
                        )}
                        <span className="shrink-0 whitespace-nowrap">{label}</span>
                        {run.status === 'done' &&
                          run.provider &&
                          run.provider !== 'none' &&
                          !isNotion &&
                          !isGitHub &&
                          !isGoogle &&
                          !isImageUnderstand &&
                          !isPaperSearch &&
                          !isBookSearch &&
                          !isBookDownload &&
                          !isPaperDownload &&
                          !isGenerateImage &&
                          !isCreateFile &&
                          !isFileRead &&
                          !isDocxExtract &&
                          !isXlsxExtract &&
                          !isSaveSkill &&
                          !isClaimReviewer &&
                          !isReviewAudit &&
                          !isReviewVerifier &&
                          !isReviewReport &&
                          !isWebRead &&
                          !isPaperRead &&
                          !isResearchPlan &&
                          !isResearchSynthesize &&
                          !isResearchVerify &&
                          !isResearchWrite &&
                          !isResearchSources && (
                            <span className="shrink-0 whitespace-nowrap opacity-50">
                              {t('searchedVia').replace(
                                '{provider}',
                                run.provider,
                              )}
                            </span>
                          )}
                        {showQueryInline && (
                          <span className="min-w-0 flex-1 truncate opacity-50">
                            ·{' '}
                            {isNotionFetch && run.results?.[0]?.title
                              ? run.results[0].title
                              : run.query}
                          </span>
                        )}
                      </button>
                      {expanded && (
                        <div className="space-y-1 pb-1 pl-5 text-[12px] leading-5 text-stone-500 dark:text-stone-400">
                          {run.status === 'awaiting_approval' &&
                            run.approval &&
                            onGmailApproval && (
                              <EmailApprovalCard
                                draft={run.approval}
                                busy={gmailApprovalBusyId === run.id}
                                error={
                                  gmailApprovalBusyId === run.id
                                    ? gmailApprovalError
                                    : null
                                }
                                onSend={(next) =>
                                  void onGmailApproval(message.id, run.id, 'send', next)
                                }
                                onCancel={() =>
                                  void onGmailApproval(
                                    message.id,
                                    run.id,
                                    'cancel',
                                    run.approval!,
                                  )
                                }
                              />
                            )}
                          {/* Query already sits on the status line for research
                              stages / reads — don't repeat it as a subtitle. */}
                          {searching &&
                          run.query &&
                          !showQueryInline &&
                          toolRunShowsFetchingResults(classification) ? (
                            <div className="truncate font-mono text-[11px] opacity-80">
                              {run.query}
                            </div>
                          ) : null}
                          {searching && toolRunShowsFetchingResults(classification) && (
                            <div>{t('fetchingResults')}</div>
                          )}
                          {run.error && (
                            <div className="text-red-600 dark:text-red-400">
                              {run.error}
                            </div>
                          )}
                          {run.status === 'done' && resultCount > 0 && (
                            <ul className={cn('space-y-2', !isImageUnderstand && 'space-y-0.5')}>
                              {(run.results || []).slice(0, 8).map((r) => (
                                <li
                                  key={r.url || r.title || r.snippet?.slice(0, 40)}
                                  className={
                                    isImageUnderstand
                                      ? 'break-words'
                                      : 'truncate'
                                  }
                                >
                                  {r.url && !isImageUnderstand ? (
                                    <a
                                      href={r.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-stone-600 underline-offset-2 hover:underline dark:text-stone-300"
                                      title={r.snippet || r.title}
                                    >
                                      {r.title || r.url}
                                    </a>
                                  ) : isImageUnderstand ? (
                                    <AnswerMarkdown
                                      text={r.snippet || r.title || ''}
                                      streaming={false}
                                      reflowBlocks={false}
                                      className="space-y-1 text-[12px] leading-5 text-stone-500 dark:text-stone-400 [&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-[12px] [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-[12px] [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-[12px] [&_p]:mb-0 [&_p]:leading-5 [&_ul]:my-1 [&_ol]:my-1"
                                    />
                                  ) : (
                                    <span title={r.snippet || r.title}>{r.title}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {run.status === 'done' &&
                            emptyResults &&
                            !isResearchPlan &&
                            !isResearchSynthesize &&
                            !isResearchVerify &&
                            !isResearchWrite && (
                              <div>{t('searchNoResults')}</div>
                            )}
                        </div>
                      )}
                    </div>
                  );
                };

                const renderAnswerMarkdown = (text: string, streaming: boolean) => (
                  <AnswerMarkdown
                    text={text}
                    streaming={streaming}
                    onSendCommand={handleSubmit}
                  />
                );

                const renderReasoningStep = (
                  step: Extract<ProcessStep, { kind: 'reasoning' }>,
                  live: boolean,
                ) => {
                  const body = step.text.trim();
                  if (!body && !live) return null;
                  // Open while thinking so it streams in view, then auto-collapse
                  // once the answer starts. Explicit user toggles win.
                  const open = reasoningOpen[step.id] ?? live;
                  return (
                    <div key={step.id} className="overflow-hidden">
                      <button
                        type="button"
                        onClick={() =>
                          setReasoningOpen((prev) => ({
                            ...prev,
                            [step.id]: !(prev[step.id] ?? true),
                          }))
                        }
                        className="flex w-full items-center gap-1.5 py-0.5 text-left text-[12px] leading-5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300"
                      >
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 shrink-0 opacity-60 transition-transform',
                            open ? 'rotate-0' : '-rotate-90',
                          )}
                        />
                        {live ? (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3 shrink-0 opacity-70" />
                        )}
                        <span>{live ? t('thinking') : t('thought')}</span>
                      </button>
                      {open && body && (
                        <ReasoningBodyScroll body={body} live={live}>
                          <AnswerMarkdown
                            text={body}
                            streaming={
                              isActiveLoading &&
                              message.id === lastMessage?.id &&
                              message.role === 'assistant'
                            }
                            // Don't reflow smashed answer tables inside Thought —
                            // verifier CoT is English prose and gets shredded.
                            reflowBlocks={false}
                            className="space-y-2 text-[12px] leading-5 text-stone-500 dark:text-stone-400 [&_p]:mb-2 [&_p]:leading-5"
                          />
                        </ReasoningBodyScroll>
                      )}
                    </div>
                  );
                };

                /** One step of a Process segment. `live` marks the trailing in-flight step. */
                const renderProcessStep = (step: ProcessStep, live: boolean) =>
                  step.kind === 'reasoning'
                    ? renderReasoningStep(step, live)
                    : renderToolStep(step);

                const renderProcessPanel = (seg: Extract<TimelineSegment, { type: 'process' }>) => {
                  // Hard gate: never spin unless this session is actually
                  // streaming. Incomplete alone (e.g. after refresh) is not live.
                  const segLive = Boolean(seg.live && isActiveLoading);
                  // While the stream is idle (replyWait), freeze Thought chrome;
                  // Waiting is shown as a Process row instead of a bare spinner.
                  const thoughtStreaming = segLive && !replyWait;
                  const lastIdx = seg.steps.length - 1;
                  const rendered = seg.steps
                    .map((step, i) =>
                      renderProcessStep(
                        step,
                        thoughtStreaming && i === lastIdx && step.kind === 'reasoning'
                          ? true
                          : segLive &&
                              i === lastIdx &&
                              step.kind === 'tool'
                            ? true
                            : false,
                      ),
                    )
                    .filter(Boolean);

                  const showWaitingRow = segLive && (replyWait || rendered.length === 0);
                  // Nothing yet and not live — skip.
                  if (rendered.length === 0 && !showWaitingRow) {
                    return null;
                  }

                  const waitingRow = showWaitingRow ? (
                    <div
                      key={`${seg.id}-waiting`}
                      className="py-0.5 text-[12px] leading-5 text-stone-500 dark:text-stone-400"
                    >
                      {t('processWaitingDetail')}
                    </div>
                  ) : null;

                  // A single step is self-describing (Thought / Searched the web …),
                  // so the outer "Process" header would only add noise — unless this
                  // segment has an explicit stage title (Plan / Search / …) or we are
                  // showing the Waiting row (needs a collapsible shell).
                  if (rendered.length === 1 && !seg.title && !showWaitingRow) {
                    return <div key={seg.id}>{rendered}</div>;
                  }

                  // Pure wait (no thought/tools yet): collapsible Waiting module.
                  if (rendered.length === 0 && showWaitingRow) {
                    const waitId = `${seg.id}-wait`;
                    const open = reasoningOpen[waitId] ?? true;
                    return (
                      <div
                        key={seg.id}
                        className={cn(
                          'overflow-hidden',
                          open &&
                            'rounded-md border border-stone-200/70 bg-stone-50/50 dark:border-stone-800/80 dark:bg-stone-900/40',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setReasoningOpen((prev) => ({
                              ...prev,
                              [waitId]: !(prev[waitId] ?? true),
                            }))
                          }
                          className={cn(
                            'flex w-full items-center gap-1.5 py-0.5 text-left text-[12px] leading-5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300',
                            open && 'px-2 pt-1.5',
                          )}
                        >
                          <ChevronDown
                            className={cn(
                              'h-3 w-3 shrink-0 opacity-60 transition-transform',
                              open ? 'rotate-0' : '-rotate-90',
                            )}
                          />
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-stone-500 dark:text-stone-400" />
                          <span>{t('processWaiting')}</span>
                        </button>
                        {open && <div className="space-y-1.5 px-2 pb-1.5 pl-6">{waitingRow}</div>}
                      </div>
                    );
                  }

                  // Keep Process open when it contains tool calls — otherwise a
                  // later Review panel (default-open) makes it look like tools
                  // never ran, while receipts only appear inside Review.
                  const hasToolSteps = seg.steps.some((s) => s.kind === 'tool');
                  const open = reasoningOpen[seg.id] ?? (segLive || hasToolSteps);
                  const segStepCount = rendered.length + (showWaitingRow ? 1 : 0);
                  return (
                    <div
                      key={seg.id}
                      className={cn(
                        'overflow-hidden',
                        open &&
                          'rounded-md border border-stone-200/70 bg-stone-50/50 dark:border-stone-800/80 dark:bg-stone-900/40',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setReasoningOpen((prev) => ({
                            ...prev,
                            [seg.id]: !(prev[seg.id] ?? true),
                          }))
                        }
                        className={cn(
                          'flex w-full items-center gap-1.5 py-0.5 text-left text-[12px] leading-5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300',
                          open && 'px-2 pt-1.5',
                        )}
                      >
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 shrink-0 opacity-60 transition-transform',
                            open ? 'rotate-0' : '-rotate-90',
                          )}
                        />
                        {segLive ? (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-stone-500 dark:text-stone-400" />
                        ) : null}
                        <span>{seg.title || t('process')}</span>
                        <span className="opacity-50">· {segStepCount}</span>
                      </button>
                      {open && (
                        <div className="space-y-1.5 px-2 pb-1.5 pl-6">
                          {rendered}
                          {waitingRow}
                        </div>
                      )}
                    </div>
                  );
                };

                const answerStreaming =
                  isActiveLoading &&
                  message.id === lastMessage?.id &&
                  message.role === 'assistant';

                const toolPendingUi = (message.toolRuns || []).some(
                  (r) => r.status === 'start',
                );
                const hasReasoningActivity = activitySteps.some(
                  (s) => s.kind === 'reasoning' && String(s.text || '').trim(),
                );
                const hasLiveProcessSeg = timelineSegments.some(
                  (s) => s.type === 'process' && s.live && messageIsStreaming,
                );
                // Fallback only when timeline has no live Process (Waiting lives there).
                const streamGapSpinner =
                  messageIsStreaming &&
                  message.incomplete &&
                  !toolPendingUi &&
                  !hasLiveProcessSeg &&
                  (replyWait || (awaitingFirstContent && !hasReasoningActivity)) ? (
                    <div
                      className="overflow-hidden rounded-md border border-stone-200/70 bg-stone-50/50 dark:border-stone-800/80 dark:bg-stone-900/40"
                      aria-label={t('generatingReply')}
                    >
                      <div className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] leading-5 text-stone-500 dark:text-stone-400">
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                        <span>{t('processWaiting')}</span>
                      </div>
                    </div>
                  ) : null;

                const renderReviewPanel = () => {
                  const report = message.reviewReport;
                  if (!report?.checks?.length) return null;

                  const panelId = `${message.id}-review`;
                  const live =
                    report.status === 'running' &&
                    messageIsStreaming &&
                    message.id === lastMessage?.id;
                  const open = reasoningOpen[panelId] ?? true;
                  const issueCount = report.checks.reduce(
                    (n, c) => n + (c.items?.length || 0),
                    0,
                  );
                  const allClean =
                    report.status === 'done' &&
                    report.checks.every(
                      (c) => c.clean !== false && (c.items?.length || 0) === 0,
                    );

                  const checkTitle = (kind: ReviewCheckKind) => t(getReviewCheckTitleKey(kind));
                  const CheckIcon = getReviewCheckIcon;

                  const renderCheck = (
                    check: NonNullable<Message['reviewReport']>['checks'][number],
                    nested = true,
                  ) => {
                    const checkKey = `${panelId}-${check.id}`;
                    const hasItems = (check.items?.length || 0) > 0;
                    const checkOpen =
                      reasoningOpen[checkKey] ??
                      (check.status === 'running' || hasItems);
                    const running = check.status === 'running';
                    const Icon = CheckIcon(check.kind);
                    const tone =
                      running
                        ? 'text-stone-500 dark:text-stone-400'
                        : check.clean === false || hasItems
                          ? 'text-amber-800 dark:text-amber-200'
                          : 'text-emerald-800 dark:text-emerald-200/90';

                    return (
                      <div key={check.id} className="overflow-hidden">
                        <button
                          type="button"
                          onClick={() =>
                            setReasoningOpen((prev) => ({
                              ...prev,
                              [checkKey]: !(prev[checkKey] ?? checkOpen),
                            }))
                          }
                          className={cn(
                            'flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-[12px] leading-5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300',
                            nested ? 'pl-4' : 'pl-0',
                          )}
                        >
                          <ChevronDown
                            className={cn(
                              'h-3 w-3 shrink-0 opacity-60 transition-transform',
                              checkOpen ? 'rotate-0' : '-rotate-90',
                            )}
                          />
                          {running ? (
                            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                          ) : (
                            <Icon className="h-3 w-3 shrink-0 opacity-70" />
                          )}
                          <span className={cn('min-w-0 flex-1 truncate', tone)}>
                            {checkTitle(check.kind)}
                            {running
                              ? ` · ${t('reviewCheckRunning')}`
                              : check.summary
                                ? ` · ${check.summary}`
                                : ''}
                          </span>
                        </button>
                        {checkOpen && (
                          <div
                            className={cn(
                              'space-y-1 pb-1.5 pr-2 text-[12px] leading-5 text-stone-500 dark:text-stone-400',
                              nested ? 'pl-9' : 'pl-5',
                            )}
                          >
                            {!hasItems && !check.body && !running && (
                              <div className="text-emerald-700 dark:text-emerald-300/90">
                                {check.summary || t('reviewFindingsClean')}
                              </div>
                            )}
                            {hasItems && (
                              <ul className="space-y-2">
                                {check.items!.map((item, idx) => (
                                  <li
                                    key={`${check.id}-${idx}`}
                                    className={cn(
                                      item.severity === 'error'
                                        ? 'text-red-700 dark:text-red-300'
                                        : 'text-amber-900 dark:text-amber-200',
                                    )}
                                  >
                                    <div className="font-medium">{item.title}</div>
                                    <div className="mt-0.5 text-[11px] opacity-85">
                                      {item.detail}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {check.body && (
                              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-stone-100/80 p-2 font-mono text-[11px] text-stone-600 dark:bg-stone-900/60 dark:text-stone-300">
                                {check.body}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  };

                  const renderedChecks = report.checks
                    .map((check) => renderCheck(check, report.checks.length > 1))
                    .filter(Boolean);

                  if (renderedChecks.length === 1) {
                    return (
                      <div key={panelId} className="mt-2">
                        {renderedChecks}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={panelId}
                      className={cn(
                        'mt-2 overflow-hidden',
                        open &&
                          'rounded-md border border-stone-200/70 bg-stone-50/50 dark:border-stone-800/80 dark:bg-stone-900/40',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setReasoningOpen((prev) => ({
                            ...prev,
                            [panelId]: !(prev[panelId] ?? true),
                          }))
                        }
                        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[12px] font-medium text-stone-600 hover:text-stone-800 dark:text-stone-300 dark:hover:text-stone-100"
                      >
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 shrink-0 opacity-60 transition-transform',
                            open ? 'rotate-0' : '-rotate-90',
                          )}
                        />
                        {live ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0 opacity-80" />
                        )}
                        <span>
                          {t('reviewPanel')}
                          {report.status === 'done' &&
                            (allClean
                              ? ''
                              : issueCount > 0
                                ? ` · ${t('reviewFindingsCount').replace('{count}', String(issueCount))}`
                                : '')}
                        </span>
                      </button>
                      {open && (
                        <div className="border-t border-stone-200/60 pb-1 dark:border-stone-800/80">
                          {renderedChecks}
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <>
                    {message.images && message.images.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {message.images.map((img, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() =>
                              onPreviewImage({
                                messageId: message.id,
                                imageIndex: idx,
                                url: img.url,
                                prompt: img.prompt || img.name || 'Image',
                                model: img.model || '',
                                timestamp: message.timestamp,
                              })
                            }
                            className="block cursor-zoom-in overflow-hidden rounded-xl border border-stone-200 bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 dark:border-stone-800 dark:bg-stone-900"
                          >
                            <img
                              src={img.url}
                              alt={img.name || 'generated'}
                              className="max-h-[420px] max-w-full object-contain"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                    {isAssistantError(message) ? (
                      <div className="rounded-xl border border-red-200 bg-red-50/80 px-3.5 py-3 dark:border-red-900/50 dark:bg-red-950/30">
                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                          {t('requestFailed')}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-red-600/90 dark:text-red-400/90">
                          {visibleContent.replace(/^Error:\s*/, '')}
                        </p>
                        {message.id === lastMessage?.id && canRetryFailed && (
                          <button
                            type="button"
                            onClick={() => retryFailedReply()}
                            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                          >
                            <RefreshCw className="h-3 w-3" />
                            {t('retry')}
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        {timelineSegments.map((seg) =>
                          seg.type === 'process' ? (
                            renderProcessPanel(seg)
                          ) : seg.type === 'file' ? (
                            (() => {
                              const fileIndex = (message.files || []).findIndex(
                                (f) => f.id === seg.fileId,
                              );
                              const file =
                                fileIndex >= 0 ? message.files?.[fileIndex] : undefined;
                              if (!file) return null;
                              const canPreview = canPreviewGeneratedFile(file);
                              return (
                                <div
                                  key={seg.id}
                                  className="flex max-w-md items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/80 p-1.5 dark:border-stone-800 dark:bg-stone-900/60"
                                >
                                  <button
                                    type="button"
                                    disabled={!canPreview}
                                    title={canPreview ? t('previewFile') : file.name}
                                    onClick={() => {
                                      if (!canPreview) return;
                                      onPreviewFile({
                                        messageId: message.id,
                                        fileIndex,
                                        id: file.id,
                                        name: file.name,
                                        mimeType: file.mimeType,
                                        size: file.size,
                                        url: file.url,
                                        content: file.content,
                                        createdAt: file.createdAt || message.timestamp,
                                      });
                                    }}
                                    className={cn(
                                      'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left',
                                      canPreview
                                        ? 'cursor-zoom-in hover:bg-white/80 dark:hover:bg-stone-950/50'
                                        : 'cursor-default',
                                    )}
                                  >
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stone-200/80 dark:bg-stone-800">
                                      <FileText className="h-4 w-4 text-stone-500" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">
                                        {file.name}
                                      </div>
                                      <div className="mt-0.5 truncate text-[11px] text-stone-400">
                                        {formatPreviewTypeLabel(file)}
                                        {file.size > 0
                                          ? ` · ${formatFileSize(file.size)}`
                                          : ''}
                                        {canPreview ? ` · ${t('previewFile')}` : ''}
                                      </div>
                                    </div>
                                  </button>
                                  <button
                                    type="button"
                                    title={t('download')}
                                    onClick={() =>
                                      void downloadGeneratedFile({
                                        messageId: message.id,
                                        fileIndex: 0,
                                        id: file.id,
                                        name: file.name,
                                        mimeType: file.mimeType,
                                        size: file.size,
                                        url: file.url,
                                        content: file.content,
                                        createdAt: file.createdAt || message.timestamp,
                                      })
                                    }
                                    className="mr-1 rounded-lg p-2 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                                  >
                                    <Download className="h-4 w-4" />
                                  </button>
                                </div>
                              );
                            })()
                          ) : seg.type === 'view' ? (
                            (() => {
                              const view = (message.views || []).find(
                                (v) => v.id === seg.viewId,
                              );
                              if (!view) return null;
                              return (
                                <div
                                  key={seg.id}
                                  className="flex max-w-md items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/80 p-1.5 dark:border-stone-800 dark:bg-stone-900/60"
                                >
                                  <button
                                    type="button"
                                    title={t('openToolView')}
                                    onClick={() => onPreviewView(view, message.id)}
                                    className="flex min-w-0 flex-1 cursor-zoom-in items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/80 dark:hover:bg-stone-950/50"
                                  >
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stone-200/80 dark:bg-stone-800">
                                      <Layers className="h-4 w-4 text-stone-500" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">
                                        {view.title}
                                      </div>
                                      <div className="mt-0.5 truncate font-mono text-[11px] text-stone-400">
                                        {view.viewType}
                                        {` · ${t('openToolView')}`}
                                      </div>
                                    </div>
                                  </button>
                                </div>
                              );
                            })()
                          ) : (
                            <div key={seg.id}>
                              {renderAnswerMarkdown(
                                seg.text,
                                answerStreaming &&
                                  seg.id === findLastContentSegmentId(timelineSegments),
                              )}
                            </div>
                          ),
                        )}
                        {renderReviewPanel()}
                        {(message.reviewFix || message.reviewFixStreaming) && (
                          <div className="mt-3 space-y-1.5 border-t border-stone-200/70 pt-3 dark:border-stone-800/80">
                            <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-800/90 dark:text-amber-200/90">
                              {message.reviewFixStreaming ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : null}
                              <span>{t('reviewCorrection')}</span>
                            </div>
                            {message.reviewFix ? (
                              renderAnswerMarkdown(
                                message.reviewFix,
                                Boolean(message.reviewFixStreaming),
                              )
                            ) : message.reviewFixStreaming ? (
                              <p className="text-[13px] text-stone-400 dark:text-stone-500">
                                …
                              </p>
                            ) : null}
                          </div>
                        )}
                        {memorySavedNotice &&
                          memorySavedNotice.count > 0 &&
                          message.id === lastMessage?.id &&
                          lastMessage?.role === 'assistant' &&
                          onViewMemorySaved &&
                          onDismissMemorySaved && (
                            <MemorySavedNotice
                              count={memorySavedNotice.count}
                              label={t('memorySavedToast', {
                                count: memorySavedNotice.count,
                              })}
                              viewLabel={t('memorySavedView')}
                              onView={onViewMemorySaved}
                              onDismiss={onDismissMemorySaved}
                            />
                          )}
                        {streamGapSpinner}
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          ),
        )}
      </div>
    )}
    </div>
    </div>
    </>
  );
}
