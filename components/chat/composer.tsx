'use client';

import type { ClipboardEvent, KeyboardEvent, RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus,
  Terminal,
  Image as ImageIcon,
  ShieldCheck,
  Play,
  ScrollText,
  Sparkles,
  Check,
  X,
  Blocks,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  FileText,
  ListOrdered,
  Search,
  Send,
  Square,
} from 'lucide-react';
import { NotionLogo } from '@/components/notion-logo';
import { GitHubLogo } from '@/components/github-logo';
import { GoogleLogo } from '@/components/google-logo';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  AttachmentImageThumb,
  isImageAttachment,
} from '@/components/attachment-image-thumb';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { IngestedAttachment } from '@/lib/files/ingest';
import type { Message, ModelOption, SkillItem } from '@/lib/chat/types';
import { BUILTIN_SKILLS, skillSlashName } from '@/lib/skills/creator';
import { formatContextWindow } from '@/lib/models/specs';
import { compactQuoteMath, prepareChatMarkdown } from '@/lib/markdown/math';

const KATEX_OPTIONS = {
  throwOnError: false,
  errorColor: 'var(--chat-math-error, #a8a29e)',
} as const;

export type SlashMenuItem =
  | { kind: 'command'; id: string; title: string; insert: string; hint: string }
  | { kind: 'skill'; skill: SkillItem };

export type ComposerQueuedTask = {
  id: string;
  content: string;
};

export type ComposerIntegrationStatus = {
  connected: boolean;
  available?: boolean;
  label?: string;
} | null;

type PlusFlyout = 'commands' | 'skills' | 'tools' | 'mcp' | null;

export type ChatComposerProps = {
  activeQueue: ComposerQueuedTask[];
  queueExpanded: boolean;
  setQueueExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  queuePaused: boolean;
  resumeQueue: () => void;
  clearQueue: () => void;
  jumpQueueAndSubmit: (taskId: string) => void;
  cancelQueuedMessage: (taskId: string) => void;

  attachError: string;
  compactNotice: string;

  canResumeIncomplete: boolean;
  truncationInfo: { reason: string };
  resumeIncompleteReply: (opts?: { force?: boolean }) => void;

  attachments: IngestedAttachment[];
  setImagePreviewSrc: (src: string | null) => void;
  removeAttachment: (id: string) => void;

  activeSkills: SkillItem[];
  toggleSkill: (skillId: string) => void;

  quotedSelections: string[];
  setQuotedSelections: (v: string[] | ((prev: string[]) => string[])) => void;
  removeQuotedSelection: (index: number) => void;

  slashMenuItems: SlashMenuItem[];
  slashHighlight: number;
  consumeSlashItem: (item: SlashMenuItem) => void;

  input: string;
  setInput: (v: string | ((prev: string) => string)) => void;
  handleKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPasteFiles: (e: ClipboardEvent) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  textareaImeProps: Record<string, unknown>;
  modelsLoading: boolean;
  selectedModel: string;

  isSkillPickerOpen: boolean;
  setIsSkillPickerOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  skillPickerRef: RefObject<HTMLDivElement | null>;
  plusMenuButtonRef: RefObject<HTMLButtonElement | null>;
  plusFlyout: PlusFlyout;
  setPlusFlyout: (v: PlusFlyout | ((prev: PlusFlyout) => PlusFlyout)) => void;
  googleMcpMenuOpen: boolean;
  setGoogleMcpMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setIsModelMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  isAccountBound: boolean;
  skills: SkillItem[];
  activeSkillIds: string[];
  fetchSkills: () => void;
  fetchIntegrations: () => void | Promise<void>;
  openLoginModal: () => void;
  requestClaimReview: () => void | Promise<void>;
  lastMessage: Message | undefined;
  isAssistantError: (m?: Message) => boolean;
  activeAutoReview: boolean;
  setActiveAutoReview: (enabled: boolean) => void;
  modelSupportsVision: boolean;
  notionStatus: ComposerIntegrationStatus;
  githubStatus: ComposerIntegrationStatus;
  googleStatus: ComposerIntegrationStatus;
  notionMcpOn: boolean;
  githubMcpOn: boolean;
  gmailMcpOn: boolean;
  calendarMcpOn: boolean;
  driveMcpOn: boolean;
  setNotionMcpEnabled: (enabled: boolean) => void;
  setGitHubMcpEnabled: (enabled: boolean) => void;
  setGoogleServiceEnabled: (service: 'gmail' | 'calendar' | 'drive', enabled: boolean) => void;
  openNotionModal: () => void;
  openGitHubModal: () => void;
  openGoogleModal: () => void;

  isModelMenuOpen: boolean;
  modelMenuRef: RefObject<HTMLDivElement | null>;
  modelSearchRef: RefObject<HTMLInputElement | null>;
  modelSearchQuery: string;
  setModelSearchQuery: (v: string | ((prev: string) => string)) => void;
  availableModels: ModelOption[];
  filteredModels: ModelOption[];
  hasImages: boolean;
  zhipuVisionOn: boolean;
  setActiveMcpIds: (v: string[] | ((prev: string[]) => string[])) => void;
  setSelectedModel: (id: string) => void;

  isActiveLoading: boolean;
  isCompacting: boolean;
  stopGenerating: () => void;
  enqueueOrSubmit: () => void;
};

export function ChatComposer(props: ChatComposerProps) {
  const { t } = useLocale();
  const {
    activeQueue,
    queueExpanded,
    setQueueExpanded,
    queuePaused,
    resumeQueue,
    clearQueue,
    jumpQueueAndSubmit,
    cancelQueuedMessage,
    attachError,
    compactNotice,
    canResumeIncomplete,
    truncationInfo,
    resumeIncompleteReply,
    attachments,
    setImagePreviewSrc,
    removeAttachment,
    activeSkills,
    toggleSkill,
    quotedSelections,
    setQuotedSelections,
    removeQuotedSelection,
    slashMenuItems,
    slashHighlight,
    consumeSlashItem,
    input,
    setInput,
    handleKeyDown,
    onPasteFiles,
    textareaRef,
    textareaImeProps,
    modelsLoading,
    selectedModel,
    isSkillPickerOpen,
    setIsSkillPickerOpen,
    skillPickerRef,
    plusMenuButtonRef,
    plusFlyout,
    setPlusFlyout,
    googleMcpMenuOpen,
    setGoogleMcpMenuOpen,
    setIsModelMenuOpen,
    isAccountBound,
    skills,
    activeSkillIds,
    fetchSkills,
    fetchIntegrations,
    openLoginModal,
    requestClaimReview,
    lastMessage,
    isAssistantError,
    activeAutoReview,
    setActiveAutoReview,
    modelSupportsVision,
    notionStatus,
    githubStatus,
    googleStatus,
    notionMcpOn,
    githubMcpOn,
    gmailMcpOn,
    calendarMcpOn,
    driveMcpOn,
    setNotionMcpEnabled,
    setGitHubMcpEnabled,
    setGoogleServiceEnabled,
    openNotionModal,
    openGitHubModal,
    openGoogleModal,
    isModelMenuOpen,
    modelMenuRef,
    modelSearchRef,
    modelSearchQuery,
    setModelSearchQuery,
    availableModels,
    filteredModels,
    hasImages,
    zhipuVisionOn,
    setActiveMcpIds,
    setSelectedModel,
    isActiveLoading,
    isCompacting,
    stopGenerating,
    enqueueOrSubmit,
  } = props;

  return (
    <>
      {/* Floating Input Area */}
      <div className="shrink-0 px-4 pb-6 pt-2 bg-gradient-to-t from-[#F9F8F6] via-[#F9F8F6] to-transparent dark:from-stone-950 dark:via-stone-950">
  <div className="mx-auto w-full max-w-[960px] px-1 md:px-4 relative">
    {/* Compact message queue */}
    <AnimatePresence>
      {activeQueue.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="mb-3 overflow-hidden rounded-2xl border border-stone-200/80 bg-white/90 shadow-sm backdrop-blur-sm dark:border-stone-700/80 dark:bg-stone-900/90"
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-stone-100 dark:border-stone-800">
            <button
              type="button"
              onClick={() => setQueueExpanded((v) => !v)}
              className="flex min-w-0 items-center gap-2 text-left"
            >
              <ListOrdered className="h-3.5 w-3.5 shrink-0 text-stone-400" />
              <span className="text-xs font-medium text-stone-700 dark:text-stone-300">
                {activeQueue.length} {t('queued')}
              </span>
              {queuePaused && (
                <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  {t('queuePaused')}
                </span>
              )}
              <ChevronDown
                className={cn(
                  'h-3 w-3 shrink-0 text-stone-400 transition-transform',
                  queueExpanded ? 'rotate-180' : '',
                )}
              />
            </button>
            <div className="flex items-center gap-1 shrink-0">
              {queuePaused && (
                <button
                  type="button"
                  onClick={resumeQueue}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-950/30"
                >
                  <Play className="h-3 w-3 fill-current" />
                  {t('resumeQueue')}
                </button>
              )}
              <button
                type="button"
                onClick={clearQueue}
                className="rounded-lg px-2 py-1 text-xs text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
              >
                {t('clear')}
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {queueExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="max-h-36 overflow-y-auto"
              >
                <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                  {activeQueue.map((task, idx) => (
                    <li
                      key={task.id}
                      className="group flex items-center gap-2 px-3 py-1.5 text-sm"
                    >
                      <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-stone-400">
                        {idx + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-stone-600 dark:text-stone-300">
                        {task.content}
                      </span>
                      <button
                        type="button"
                        onClick={() => jumpQueueAndSubmit(task.id)}
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-orange-600 opacity-70 hover:bg-orange-50 hover:opacity-100 group-hover:opacity-100 dark:text-orange-400 dark:hover:bg-orange-950/30"
                      >
                        Send
                      </button>
                      <button
                        type="button"
                        onClick={() => cancelQueuedMessage(task.id)}
                        className="shrink-0 rounded-md p-0.5 text-stone-300 opacity-70 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-950/20"
                        title="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>

    {(attachError || compactNotice) && (
      <div className="mb-2 text-center text-xs text-amber-700 dark:text-amber-300">
        {attachError || compactNotice}
      </div>
    )}

    {/* Continue — only when the last reply was clearly interrupted.
        Sits above the composer so it reads as "finish that reply".
        Failed requests use the Retry on the error card instead. */}
    <AnimatePresence>
      {canResumeIncomplete && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          className="mb-2 flex justify-center"
        >
          <button
            type="button"
            onClick={() => resumeIncompleteReply()}
            title={truncationInfo.reason || 'Continue the previous reply'}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3.5 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            <Play className="h-3 w-3 fill-current" />
            Continue
            {truncationInfo.reason && (
              <span className="hidden sm:inline font-normal text-stone-500 dark:text-stone-400">
                · {truncationInfo.reason}
              </span>
            )}
          </button>
        </motion.div>
      )}
    </AnimatePresence>

    <div className="flex flex-col rounded-2xl border border-stone-300 bg-white shadow-sm focus-within:ring-2 focus-within:ring-stone-400/20 focus-within:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:focus-within:border-stone-500 transition-all relative">
      {attachments.length > 0 && (
        <div className="px-3 pt-3 pb-1 flex flex-wrap gap-2">
          {attachments.map((a) =>
            isImageAttachment(a) ? (
              <AttachmentImageThumb
                key={a.id}
                attachment={a}
                onPreview={setImagePreviewSrc}
                onRemove={() => removeAttachment(a.id)}
              />
            ) : (
              <div
                key={a.id}
                className="group flex max-w-full items-center gap-2 rounded-xl border border-stone-200 bg-white px-2 py-1.5 text-xs shadow-sm dark:border-stone-700 dark:bg-stone-900"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                <span className="truncate text-stone-600 dark:text-stone-300">{a.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-red-500 dark:hover:bg-stone-800"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ),
          )}
        </div>
      )}
      {activeSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {activeSkills.map((skill) => (
            <span
              key={skill.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-stone-300 bg-stone-100 pl-2 pr-1 py-0.5 text-[11px] font-medium text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200"
              title={`/${skillSlashName(skill.title)}`}
            >
              <ScrollText className="h-3 w-3 shrink-0" />
              <span className="truncate">{skill.title}</span>
              <button
                type="button"
                onClick={() => toggleSkill(skill.id)}
                className="rounded-full p-0.5 hover:bg-stone-200 dark:hover:bg-stone-700"
                title="移除 Skill"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {quotedSelections.length > 0 && (
        <div className="mx-3 mt-2 space-y-1 border-b border-stone-200/80 pb-2 dark:border-stone-700/80">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              {quotedSelections.length === 1
                ? t('quoted')
                : t('quotedCount', { n: quotedSelections.length })}
            </div>
            {quotedSelections.length > 1 && (
              <button
                type="button"
                onClick={() => setQuotedSelections([])}
                className="text-[10px] font-medium text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
              >
                {t('clearAllQuotes')}
              </button>
            )}
          </div>
          <div className="space-y-1">
            {quotedSelections.map((quote, index) => (
              <div
                key={`${index}-${quote.slice(0, 24)}`}
                className="group flex items-start gap-1"
              >
                <blockquote className="min-w-0 flex-1 border-l-2 border-stone-400/70 py-0 pl-2.5 dark:border-stone-500">
                  <div className="chat-markdown chat-quote line-clamp-3 text-[12px] leading-4 text-stone-500 dark:text-stone-400 [&_p]:mb-0 [&_p]:leading-4">
                    <ReactMarkdown
                      remarkPlugins={[remarkMath, remarkGfm]}
                      rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
                      components={{
                        p({ children }: any) {
                          return <p className="whitespace-pre-wrap">{children}</p>;
                        },
                        code({ children }: any) {
                          return (
                            <code className="rounded bg-stone-200/60 px-1 py-0.5 font-mono text-[11px] dark:bg-stone-800">
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {prepareChatMarkdown(compactQuoteMath(quote))}
                    </ReactMarkdown>
                  </div>
                </blockquote>
                <button
                  type="button"
                  onClick={() => removeQuotedSelection(index)}
                  className="mt-0 shrink-0 rounded p-0.5 text-stone-400 opacity-70 hover:bg-stone-100 hover:text-stone-700 group-hover:opacity-100 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  title={t('clearQuote')}
                  aria-label={t('clearQuote')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Slash-command menu: /image + Skills */}
      <AnimatePresence>
        {slashMenuItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute left-3 right-3 bottom-full mb-2 z-40 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-900"
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400 border-b border-stone-100 dark:border-stone-800">
              Commands
            </div>
            {slashMenuItems.map((item, idx) => (
              <button
                key={item.kind === 'skill' ? item.skill.id : item.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  consumeSlashItem(item);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  idx === slashHighlight
                    ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                    : 'text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800',
                )}
              >
                {item.kind === 'command' ? (
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                ) : (
                  <ScrollText className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">
                  {item.kind === 'command' ? item.title : item.skill.title}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-stone-400">
                  {item.kind === 'command'
                    ? item.hint
                    : `/${skillSlashName(item.skill.title)}`}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <Textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        {...textareaImeProps}
        onPaste={onPasteFiles}
        placeholder={
          modelsLoading
            ? t('loadingModels')
            : t('writeMessage', { model: selectedModel || 'AI' })
        }
        className="min-h-[60px] max-h-[300px] w-full resize-none border-0 bg-transparent px-4 py-4 text-base focus-visible:ring-0 placeholder:text-stone-400"
      />
      
      <div className="flex items-center justify-between px-3 pb-3 pt-1">
        <div className="flex items-center gap-1.5">
          <div className="relative" ref={skillPickerRef}>
            <button
              ref={plusMenuButtonRef}
              type="button"
              onClick={() => {
                setIsSkillPickerOpen((v) => {
                  const next = !v;
                  setPlusFlyout(null);
                  if (!next) {
                    queueMicrotask(() => plusMenuButtonRef.current?.blur());
                  }
                  return next;
                });
                setIsModelMenuOpen(false);
                if (isAccountBound && skills.length === 0) fetchSkills();
              }}
              title="Add"
              aria-expanded={isSkillPickerOpen}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/40',
                isSkillPickerOpen
                  ? 'bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100'
                  : 'text-stone-500 [@media(hover:hover)]:hover:bg-stone-100 dark:text-stone-400 dark:[@media(hover:hover)]:hover:bg-stone-800',
              )}
            >
              <Plus className="h-4 w-4" />
            </button>
            <AnimatePresence>
              {isSkillPickerOpen && (
                <div className="absolute left-0 bottom-10 z-30">
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className="relative w-56 rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
                  >
                    <button
                      type="button"
                      onPointerEnter={() => {
                        setPlusFlyout('commands');
                        setGoogleMcpMenuOpen(false);
                      }}
                      onClick={() => {
                        setPlusFlyout((v) => (v === 'commands' ? null : 'commands'));
                        setGoogleMcpMenuOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                        plusFlyout === 'commands'
                          ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                          : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800',
                      )}
                    >
                      <Terminal className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                      <span className="min-w-0 flex-1">{t('commandLayer')}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                    </button>

                    <button
                      type="button"
                      onPointerEnter={() => {
                        setPlusFlyout('skills');
                        setGoogleMcpMenuOpen(false);
                        if (isAccountBound && skills.length === 0) fetchSkills();
                      }}
                      onClick={() => {
                        setPlusFlyout((v) => (v === 'skills' ? null : 'skills'));
                        setGoogleMcpMenuOpen(false);
                        if (isAccountBound && skills.length === 0) fetchSkills();
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                        plusFlyout === 'skills'
                          ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                          : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800',
                      )}
                    >
                      <ScrollText className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                      <span className="min-w-0 flex-1">{t('skills')}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                    </button>

                    <button
                      type="button"
                      onPointerEnter={() => {
                        setPlusFlyout('tools');
                        setGoogleMcpMenuOpen(false);
                      }}
                      onClick={() => {
                        setPlusFlyout((v) => (v === 'tools' ? null : 'tools'));
                        setGoogleMcpMenuOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                        plusFlyout === 'tools'
                          ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                          : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800',
                      )}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                      <span className="min-w-0 flex-1">{t('toolLayer')}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                    </button>

                    <button
                      type="button"
                      onPointerEnter={() => {
                        setPlusFlyout('mcp');
                        void fetchIntegrations();
                      }}
                      onClick={() => {
                        setPlusFlyout((v) => (v === 'mcp' ? null : 'mcp'));
                        void fetchIntegrations();
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                        plusFlyout === 'mcp'
                          ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                          : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800',
                      )}
                    >
                      <Blocks className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                      <span className="min-w-0 flex-1">{t('mcpTools')}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                    </button>

                    <AnimatePresence>
                      {plusFlyout === 'commands' && (
                        <motion.div
                          key="plus-commands-flyout"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.1 }}
                          onPointerEnter={() => {
                            setPlusFlyout('commands');
                            setGoogleMcpMenuOpen(false);
                          }}
                          className="absolute left-[calc(100%+6px)] top-0 z-10 w-60 rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (!isAccountBound) {
                                setIsSkillPickerOpen(false);
                                setPlusFlyout(null);
                                openLoginModal();
                                return;
                              }
                              setIsSkillPickerOpen(false);
                              setPlusFlyout(null);
                              setInput('/image ');
                              textareaRef.current?.focus();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                          >
                            <ImageIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 flex-1">{t('generateImage')}</span>
                            <span className="shrink-0 font-mono text-[10px] text-stone-400">
                              /image
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsSkillPickerOpen(false);
                              setPlusFlyout(null);
                              void requestClaimReview();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                          >
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 flex-1">{t('requestReview')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsSkillPickerOpen(false);
                              setPlusFlyout(null);
                              void resumeIncompleteReply({ force: true });
                            }}
                            disabled={
                              isActiveLoading ||
                              !lastMessage ||
                              lastMessage.role !== 'assistant' ||
                              isAssistantError(lastMessage)
                            }
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-200 dark:hover:bg-stone-800"
                            title={t('continueCommandHint')}
                          >
                            <Play className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 flex-1">{t('continueCommand')}</span>
                          </button>
                        </motion.div>
                      )}

                      {plusFlyout === 'skills' && (
                        <motion.div
                          key="plus-skills-flyout"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.1 }}
                          onPointerEnter={() => {
                            setPlusFlyout('skills');
                            setGoogleMcpMenuOpen(false);
                          }}
                          className="absolute left-[calc(100%+6px)] top-[2.35rem] z-10 max-h-72 w-60 overflow-y-auto rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
                        >
                        {!isAccountBound ? (
                          <button
                            type="button"
                            onClick={() => {
                              setIsSkillPickerOpen(false);
                              setPlusFlyout(null);
                              openLoginModal();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                          >
                            {t('connectAccount')}
                          </button>
                        ) : (
                          <>
                            {BUILTIN_SKILLS.map((skill) => {
                              const on = activeSkillIds.includes(skill.id);
                              return (
                                <button
                                  key={skill.id}
                                  type="button"
                                  onClick={() => toggleSkill(skill.id)}
                                  className={cn(
                                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                                    on
                                      ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                                      : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800',
                                  )}
                                >
                                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                                  <span className="min-w-0 flex-1 truncate">{skill.title}</span>
                                  {on && <Check className="h-3.5 w-3.5 shrink-0 text-stone-500" />}
                                </button>
                              );
                            })}
                            {skills.length === 0 ? null : (
                              skills.map((skill) => {
                                const on = activeSkillIds.includes(skill.id);
                                return (
                                  <button
                                    key={skill.id}
                                    type="button"
                                    onClick={() => toggleSkill(skill.id)}
                                    className={cn(
                                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                                      on
                                        ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                                        : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800',
                                    )}
                                  >
                                    <ScrollText className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                                    <span className="min-w-0 flex-1 truncate">
                                      {skill.title}
                                    </span>
                                    {on ? (
                                      <Check className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                                    ) : (
                                      <span className="shrink-0 font-mono text-[10px] text-stone-400">
                                        /{skillSlashName(skill.title)}
                                      </span>
                                    )}
                                  </button>
                                );
                              })
                            )}
                          </>
                        )}
                        </motion.div>
                      )}

                      {plusFlyout === 'tools' && (
                        <motion.div
                          key="plus-tools-flyout"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.1 }}
                          onPointerEnter={() => {
                            setPlusFlyout('tools');
                          }}
                          className="absolute left-[calc(100%+6px)] top-[4.7rem] z-10 w-60 rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
                        >
                          <div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-stone-800 dark:text-stone-100">
                                {t('autoReview')}
                              </div>
                              <div className="truncate text-[10px] text-stone-400">
                                {t('autoReviewHint')}
                              </div>
                            </div>
                            <Switch
                              size="sm"
                              checked={activeAutoReview}
                              onCheckedChange={setActiveAutoReview}
                              aria-label={t('autoReview')}
                            />
                          </div>
                          <div
                            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-stone-400 dark:text-stone-500"
                            title={
                              modelSupportsVision
                                ? t('imageUnderstandDisabledOnVision')
                                : t('zhipuVisionMcpHint')
                            }
                            aria-disabled
                          >
                            <ImageIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm">{t('enableZhipuVisionMcp')}</div>
                              <div className="truncate text-[10px] opacity-80">
                                {modelSupportsVision
                                  ? t('imageUnderstandDisabledOnVision')
                                  : t('imageUnderstandBuiltIn')}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {plusFlyout === 'mcp' && (
                        <motion.div
                          key="plus-mcp-flyout"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.1 }}
                          onPointerEnter={() => {
                            setPlusFlyout('mcp');
                          }}
                          className="absolute left-[calc(100%+6px)] bottom-0 z-10 w-60 rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
                        >
                        <div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                          <NotionLogo className="h-3.5 w-3.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-stone-800 dark:text-stone-100">
                              Notion
                            </div>
                            <div className="truncate text-[10px] text-stone-400">
                              {notionStatus?.connected
                                ? t('useInThisChat')
                                : t('notionMcpNeedsConnect')}
                            </div>
                          </div>
                          {notionStatus?.connected ? (
                            <Switch
                              size="sm"
                              checked={notionMcpOn}
                              onCheckedChange={setNotionMcpEnabled}
                              aria-label={t('enableNotionMcp')}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setIsSkillPickerOpen(false);
                                setPlusFlyout(null);
                                openNotionModal();
                              }}
                              className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                            >
                              {t('connectNotion')}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                          <GitHubLogo className="h-3.5 w-3.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-stone-800 dark:text-stone-100">
                              GitHub
                            </div>
                            <div className="truncate text-[10px] text-stone-400">
                              {githubStatus?.connected
                                ? t('useInThisChat')
                                : t('githubMcpNeedsConnect')}
                            </div>
                          </div>
                          {githubStatus?.connected ? (
                            <Switch
                              size="sm"
                              checked={githubMcpOn}
                              onCheckedChange={setGitHubMcpEnabled}
                              aria-label={t('enableGitHubMcp')}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setIsSkillPickerOpen(false);
                                setPlusFlyout(null);
                                openGitHubModal();
                              }}
                              className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                            >
                              {t('connectGitHub')}
                            </button>
                          )}
                        </div>
                        <div>
                          {googleStatus?.connected ? (
                            <button
                              type="button"
                              onClick={() => setGoogleMcpMenuOpen((open) => !open)}
                              className={cn(
                                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left',
                                googleMcpMenuOpen && 'bg-stone-100 dark:bg-stone-800',
                                '[@media(hover:hover)]:hover:bg-stone-100 dark:[@media(hover:hover)]:hover:bg-stone-800',
                              )}
                              aria-expanded={googleMcpMenuOpen}
                            >
                              <GoogleLogo className="h-3.5 w-3.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-stone-800 dark:text-stone-100">
                                  Google
                                </div>
                                <div className="truncate text-[10px] text-stone-400">
                                  {t('useInThisChat')}
                                </div>
                              </div>
                              <ChevronDown
                                className={cn(
                                  'h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform',
                                  googleMcpMenuOpen && 'rotate-180',
                                )}
                              />
                            </button>
                          ) : (
                            <div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                              <GoogleLogo className="h-3.5 w-3.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-stone-800 dark:text-stone-100">
                                  Google
                                </div>
                                <div className="truncate text-[10px] text-stone-400">
                                  {t('googleMcpNeedsConnect')}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsSkillPickerOpen(false);
                                  setPlusFlyout(null);
                                  openGoogleModal();
                                }}
                                className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                              >
                                {t('connectGoogle')}
                              </button>
                            </div>
                          )}
                          <AnimatePresence initial={false}>
                            {googleStatus?.connected && googleMcpMenuOpen && (
                              <motion.div
                                key="google-mcp-inline"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="overflow-hidden"
                              >
                                <div className="ml-5 border-l border-stone-200 py-0.5 pl-2 dark:border-stone-700">
                                  {[
                                    {
                                      id: 'gmail' as const,
                                      label: t('enableGmailMcp'),
                                      on: gmailMcpOn,
                                    },
                                    {
                                      id: 'calendar' as const,
                                      label: t('enableCalendarMcp'),
                                      on: calendarMcpOn,
                                    },
                                    {
                                      id: 'drive' as const,
                                      label: t('enableDriveMcp'),
                                      on: driveMcpOn,
                                    },
                                  ].map((row) => (
                                    <div
                                      key={row.id}
                                      className="flex items-center gap-2 rounded-md px-2 py-1.5"
                                    >
                                      <div className="min-w-0 flex-1 truncate text-xs text-stone-700 dark:text-stone-200">
                                        {row.label}
                                      </div>
                                      <Switch
                                        size="sm"
                                        checked={row.on}
                                        onCheckedChange={(enabled) =>
                                          setGoogleServiceEnabled(row.id, enabled)
                                        }
                                        aria-label={row.label}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative" ref={modelMenuRef}>
            <button 
              onClick={() => {
                setIsModelMenuOpen((open) => {
                  if (open) setModelSearchQuery('');
                  return !open;
                });
              }}
              className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg hover:bg-stone-100 text-xs font-medium text-stone-600 transition-colors dark:text-stone-400 dark:hover:bg-stone-800"
            >
              <span className="truncate max-w-[140px] sm:max-w-[200px] text-left">
                {modelsLoading 
                  ? t('loadingModels')
                  : (availableModels.find(m => m.id === selectedModel)?.id || selectedModel || t('selectModel'))}
              </span>
              <ChevronDown className="h-3 w-3 text-stone-400" />
            </button>

            <AnimatePresence>
              {isModelMenuOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="absolute left-0 bottom-10 mb-2 z-30 flex w-[280px] sm:w-80 max-h-[420px] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-900"
                >
                  <div className="shrink-0 space-y-2 border-b border-stone-100 p-2 dark:border-stone-800">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
                      <input
                        ref={modelSearchRef}
                        type="text"
                        value={modelSearchQuery}
                        onChange={(e) => setModelSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder={t('searchModels')}
                        className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-8 pr-8 text-xs text-stone-800 outline-none placeholder:text-stone-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-200/60 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-orange-700 dark:focus:ring-orange-900/40"
                      />
                      {modelSearchQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setModelSearchQuery('');
                            modelSearchRef.current?.focus();
                          }}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
                          aria-label="Clear search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                        {isAccountBound ? t('allModels') : t('freeModels')}
                      </span>
                      <span className="text-[10px] text-stone-400">
                        {modelSearchQuery.trim()
                          ? `${filteredModels.length} / ${availableModels.length}`
                          : `${availableModels.length} models`}
                      </span>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {availableModels.length === 0 && !modelsLoading && (
                    <div className="p-4 text-center text-xs text-stone-400">
                      {isAccountBound ? 'No models found. Check connection.' : 'No free models available.'}
                    </div>
                  )}
                  {modelsLoading && availableModels.length === 0 && (
                    <div className="p-4 text-center text-xs text-stone-400">
                      Loading...
                    </div>
                  )}
                  {availableModels.length > 0 && filteredModels.length === 0 && (
                    <div className="p-4 text-center text-xs text-stone-400">
                      No models match “{modelSearchQuery.trim()}”
                    </div>
                  )}
                  {filteredModels.map(m => {
                    // Vision models auto-disable Image Understand. Don't trap users:
                    // logged-in accounts can pick a text model again — we re-enable
                    // Image Understand on select. Guests still need a Vision model.
                    const blocked =
                      hasImages && !m.vision && !zhipuVisionOn && !isAccountBound;
                    const softWarn = hasImages && !m.vision && isAccountBound;
                    return (
                    <button
                      key={m.id}
                      disabled={blocked}
                      onClick={() => {
                        if (blocked) return;
                        if (hasImages && !m.vision && isAccountBound) {
                          setActiveMcpIds((prev) =>
                            prev.includes('zhipu-vision')
                              ? prev
                              : [...prev, 'zhipu-vision'],
                          );
                        }
                        setSelectedModel(m.id);
                        setIsModelMenuOpen(false);
                        setModelSearchQuery('');
                      }}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left gap-2",
                        blocked && "opacity-40 cursor-not-allowed",
                        selectedModel === m.id 
                          ? "bg-stone-100 text-stone-900 font-medium dark:bg-stone-800 dark:text-stone-100" 
                          : "hover:bg-stone-100 text-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                      )}
                      title={
                        blocked
                          ? t('imagesNeedVision')
                          : softWarn
                            ? t('imagesPreferVision')
                            : undefined
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{m.id}</div>
                        {blocked && (
                          <div className="text-[10px] text-stone-400">{t('textOnlyNeedsVision')}</div>
                        )}
                        {softWarn && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400">
                            {t('textOnlyViaImageUnderstand')}
                          </div>
                        )}
                      </div>
                      <span
                        className="text-[9px] font-mono text-stone-400 shrink-0 tabular-nums"
                        title={m.context_window != null ? `${m.context_window.toLocaleString()} context` : 'Unknown context'}
                      >
                        {formatContextWindow(m.context_window)}
                      </span>
                      {m.vision && (
                        <span
                          title="Vision"
                          className="text-[8px] font-semibold leading-none rounded border border-stone-200 bg-stone-50 px-1 py-px text-stone-500 shrink-0 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400"
                        >
                          V
                        </span>
                      )}
                      {m.tier === 'paid' ? (
                        <span className="text-[8px] font-semibold leading-none rounded bg-orange-500 px-1 py-px text-white shrink-0">
                          Pro
                        </span>
                      ) : (
                        <span className="text-[8px] font-semibold leading-none rounded border border-orange-200 bg-orange-50 px-1 py-px text-orange-700 shrink-0 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-300">
                          Free
                        </span>
                      )}
                      {selectedModel === m.id && <Check className="h-3.5 w-3.5 text-stone-500 shrink-0" />}
                    </button>
                    );
                  })}
                  </div>
                  {!isAccountBound && (
                    <div className="shrink-0 border-t border-stone-100 p-2 dark:border-stone-800">
                      <button 
                        onClick={() => { setIsModelMenuOpen(false); setModelSearchQuery(''); openLoginModal(); }}
                        className="w-full text-center text-xs font-medium text-orange-600 hover:underline"
                      >
                        🔓 Sign in to unlock {availableModels.length > 0 ? 'all models' : 'premium'}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {isActiveLoading ? (
            <Button 
              onClick={() => stopGenerating()}
              size="icon" 
              title={t('stop')}
              className="h-8 w-8 rounded-full bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:text-stone-900"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button 
              onClick={() => enqueueOrSubmit()}
              disabled={(!input.trim() && quotedSelections.length === 0 && attachments.length === 0) || isCompacting}
              size="icon" 
              title="Send"
              className={cn(
                "h-8 w-8 rounded-full transition-all active:scale-95",
                (input.trim() || attachments.length > 0)
                  ? "bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
                  : "bg-stone-200 text-stone-400 dark:bg-stone-800 dark:text-stone-500"
              )}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  </div>
</div>
    </>
  );
}
