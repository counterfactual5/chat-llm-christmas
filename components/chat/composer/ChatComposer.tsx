'use client';

import { useState } from 'react';
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
  FlaskConical,
  BookOpen,
  GraduationCap,
  Globe,
  Newspaper,
  Library,
  Send,
  Square,
  Loader2,
} from 'lucide-react';
import { NotionLogo } from '@/components/integrations/logos/NotionLogo';
import { GitHubLogo } from '@/components/integrations/logos/GitHubLogo';
import { GoogleLogo } from '@/components/integrations/logos/GoogleLogo';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  AttachmentImageThumb,
  isImageAttachment,
} from '@/components/files/AttachmentImageThumb';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { IngestedAttachment } from '@/lib/files/ingest';
import type { Message, ModelOption, SkillItem } from '@/lib/chat/types';
import { skillSlashName } from '@/lib/skills/creator';
import { compactQuoteMath, prepareChatMarkdown } from '@/lib/markdown/math';
import {
  ComposerQueuePanel,
  type ComposerQueuedTask,
} from './ComposerQueuePanel';
import { ComposerModelMenu } from './ComposerModelMenu';

const KATEX_OPTIONS = {
  throwOnError: false,
  errorColor: 'var(--chat-math-error, #a8a29e)',
} as const;

export type SlashMenuItem =
  | { kind: 'command'; id: string; title: string; insert: string; hint: string }
  | { kind: 'skill'; skill: SkillItem };



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
  truncationInfo: { reason: string; shortReason?: string };
  resumeIncompleteReply: (opts?: { force?: boolean }) => void;

  attachments: IngestedAttachment[];
  setImagePreviewSrc: (src: string | null) => void;
  removeAttachment: (id: string) => void;

  activeSkills: SkillItem[];
  skillCreatorActive: boolean;
  dismissSkillCreator: () => void;
  toggleSkill: (skillId: string) => void;
  onPreviewSkill: (skill: SkillItem) => void;

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
  requestClaimReview: (opts?: {
    focus?: string;
    userContent?: string;
  }) => void | Promise<void>;
  lastMessage: Message | undefined;
  isAssistantError: (m?: Message) => boolean;
  activeAutoReview: boolean;
  setActiveAutoReview: (enabled: boolean) => void;
  paperSearchEnabled: boolean;
  bookSearchEnabled: boolean;
  generateImageEnabled: boolean;
  setPaperSearchEnabled: (enabled: boolean) => void;
  setBookSearchEnabled: (enabled: boolean) => void;
  setGenerateImageEnabled: (enabled: boolean) => void;
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

  researchBusy: boolean;
  researchError?: string | null;
  cancelResearch: () => void;
};

export function ChatComposer(props: ChatComposerProps) {
  const { t } = useLocale();
  const [builtinsExpanded, setBuiltinsExpanded] = useState(true);
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
    skillCreatorActive,
    dismissSkillCreator,
    toggleSkill,
    onPreviewSkill,
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
    paperSearchEnabled,
    bookSearchEnabled,
    generateImageEnabled,
    setPaperSearchEnabled,
    setBookSearchEnabled,
    setGenerateImageEnabled,
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
    researchBusy,
    researchError,
    cancelResearch,
  } = props;

  return (
    <>
      {/* Floating Input Area */}
      {/*
        Avoid overflow-x-hidden on shells that contain the + menu: flyouts are
        position:absolute and grow upward/right; overflow-x:hidden forces
        overflow-y clipping and hides Tools rows (empty-looking Built-in panel).
        Message-list overflow-x-hidden already stops page horizontal scroll.
      */}
      <div className="min-w-0 shrink-0 px-4 pb-6 pt-2 bg-gradient-to-t from-[#F9F8F6] via-[#F9F8F6] to-transparent dark:from-stone-950 dark:via-stone-950">
  <div className="relative mx-auto w-full min-w-0 max-w-[960px] px-1 md:px-4">
    <ComposerQueuePanel
      activeQueue={activeQueue}
      queueExpanded={queueExpanded}
      setQueueExpanded={setQueueExpanded}
      queuePaused={queuePaused}
      resumeQueue={resumeQueue}
      clearQueue={clearQueue}
      jumpQueueAndSubmit={jumpQueueAndSubmit}
      cancelQueuedMessage={cancelQueuedMessage}
    />

    {/* Error / interrupt reason sits above Continue — never inside the button. */}
    {(() => {
      const interruptReason =
        canResumeIncomplete && truncationInfo.reason ? truncationInfo.reason : '';
      const bannerText = researchError || interruptReason || attachError || compactNotice;
      return bannerText ? (
        <div className="mb-2 px-2 text-center text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          {bannerText}
        </div>
      ) : null;
    })()}

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
            onClick={() => resumeIncompleteReply({ force: true })}
            title={truncationInfo.reason || 'Continue the previous reply'}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3.5 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            <Play className="h-3 w-3 fill-current" />
            Continue
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
                <span className="truncate text-stone-600 dark:text-stone-300">{a.name}</span>
                {a.fileId && !a.uploading && (
                  <span className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400">✓</span>
                )}
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
      {(skillCreatorActive || activeSkills.length > 0) && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {skillCreatorActive && (
            <span
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-orange-300 bg-orange-50 pl-2 pr-1 py-0.5 text-[11px] font-medium text-orange-800 dark:border-orange-700/60 dark:bg-orange-950/40 dark:text-orange-200"
              title={t('skillCreatorChipHint')}
            >
              <Sparkles className="h-3 w-3 shrink-0" />
              <span className="truncate">{t('skillCreatorChip')}</span>
              <button
                type="button"
                onClick={dismissSkillCreator}
                className="rounded-full p-0.5 hover:bg-orange-100 dark:hover:bg-orange-900/50"
                title={t('skillCreatorChipHint')}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {activeSkills.map((skill) => (
            <span
              key={skill.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-stone-300 bg-stone-100 pl-2 pr-1 py-0.5 text-[11px] font-medium text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200"
              title={`/${skillSlashName(skill.title)}`}
            >
              <button
                type="button"
                onClick={() => onPreviewSkill(skill)}
                className="inline-flex min-w-0 items-center gap-1 hover:opacity-80"
                title={t('previewSkill')}
              >
                <ScrollText className="h-3 w-3 shrink-0" />
                <span className="truncate">{skill.title}</span>
              </button>
              <button
                type="button"
                onClick={() => toggleSkill(skill.id)}
                className="rounded-full p-0.5 hover:bg-stone-200 dark:hover:bg-stone-700"
                title={t('removeSkillFromChat')}
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
              {slashMenuItems.every(
                (item) =>
                  item.kind === 'command' && item.id.startsWith('research-mode-'),
              )
                ? t('researchModePicker')
                : slashMenuItems.every(
                      (item) =>
                        item.kind === 'command' && item.id.startsWith('research-source-'),
                    )
                  ? t('researchSourcePicker')
                  : 'Commands'}
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
                  item.id === 'skill-create' ? (
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                  ) : item.id === 'review' ? (
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                  ) : item.id === 'continue' ? (
                    <Play className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                  ) : item.id === 'research' ||
                    item.id.startsWith('research-mode-') ||
                    item.id.startsWith('research-source-') ? (
                    <FlaskConical className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                  )
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
                          className="absolute bottom-0 left-[calc(100%+6px)] z-10 max-h-[min(22rem,calc(100dvh-5.5rem))] w-60 overflow-y-auto overflow-x-hidden rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md max-sm:bottom-[calc(100%+6px)] max-sm:left-0 dark:border-stone-700 dark:bg-stone-900/95"
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
                              if (!isAccountBound) {
                                setIsSkillPickerOpen(false);
                                setPlusFlyout(null);
                                openLoginModal();
                                return;
                              }
                              setIsSkillPickerOpen(false);
                              setPlusFlyout(null);
                              setInput('/research ');
                              textareaRef.current?.focus();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                          >
                            <FlaskConical className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 flex-1">{t('deepResearchCommand')}</span>
                            <span className="shrink-0 font-mono text-[10px] text-stone-400">
                              /research
                            </span>
                          </button>
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
                              setInput('/news ');
                              textareaRef.current?.focus();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                          >
                            <Newspaper className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 flex-1">{t('newsCommand')}</span>
                            <span className="shrink-0 font-mono text-[10px] text-stone-400">
                              /news
                            </span>
                          </button>
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
                              setInput('/wiki ');
                              textareaRef.current?.focus();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                          >
                            <Library className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 flex-1">{t('wikiCommand')}</span>
                            <span className="shrink-0 font-mono text-[10px] text-stone-400">
                              /wiki
                            </span>
                          </button>
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
                              setInput('/papers ');
                              textareaRef.current?.focus();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                          >
                            <GraduationCap className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 flex-1">{t('papersCommand')}</span>
                            <span className="shrink-0 font-mono text-[10px] text-stone-400">
                              /papers
                            </span>
                          </button>
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
                              setInput('/books ');
                              textareaRef.current?.focus();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                          >
                            <BookOpen className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 flex-1">{t('booksCommand')}</span>
                            <span className="shrink-0 font-mono text-[10px] text-stone-400">
                              /books
                            </span>
                          </button>
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
                              setInput('/skill ');
                              textareaRef.current?.focus();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                          >
                            <Sparkles className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 flex-1">{t('createSkillCommand')}</span>
                            <span className="shrink-0 font-mono text-[10px] text-stone-400">
                              /skill
                            </span>
                          </button>
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
                              setInput('/review ');
                              textareaRef.current?.focus();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                          >
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <span className="min-w-0 flex-1">{t('requestReview')}</span>
                            <span className="shrink-0 font-mono text-[10px] text-stone-400">
                              /review
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsSkillPickerOpen(false);
                              setPlusFlyout(null);
                              void resumeIncompleteReply({ force: true });
                            }}
                            disabled={!canResumeIncomplete}
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
                          className="absolute bottom-0 left-[calc(100%+6px)] z-10 max-h-[min(22rem,calc(100dvh-5.5rem))] w-60 overflow-y-auto overflow-x-hidden rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md max-sm:bottom-[calc(100%+6px)] max-sm:left-0 dark:border-stone-700 dark:bg-stone-900/95"
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
                          className="absolute bottom-0 left-[calc(100%+6px)] z-10 max-h-[min(22rem,calc(100dvh-5.5rem))] w-60 overflow-y-auto overflow-x-hidden rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md max-sm:bottom-[calc(100%+6px)] max-sm:left-0 dark:border-stone-700 dark:bg-stone-900/95"
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
<div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                            <ImageIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-stone-800 dark:text-stone-100">
                                {t('generateImageTool')}
                              </div>
                              <div className="truncate text-[10px] text-stone-400">
                                {t('generateImageToolHint')}
                              </div>
                            </div>
                            <Switch
                              size="sm"
                              checked={generateImageEnabled}
                              onCheckedChange={setGenerateImageEnabled}
                              aria-label={t('generateImageTool')}
                            />
                          </div>
<div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                            <GraduationCap className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-stone-800 dark:text-stone-100">
                                {t('paperSearchTool')}
                              </div>
                              <div className="truncate text-[10px] text-stone-400">
                                {t('paperSearchToolHint')}
                              </div>
                            </div>
                            <Switch
                              size="sm"
                              checked={paperSearchEnabled}
                              onCheckedChange={setPaperSearchEnabled}
                              aria-label={t('paperSearchTool')}
                            />
                          </div>
<div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                            <BookOpen className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-stone-800 dark:text-stone-100">
                                {t('bookSearchTool')}
                              </div>
                              <div className="truncate text-[10px] text-stone-400">
                                {t('bookSearchToolHint')}
                              </div>
                            </div>
                            <Switch
                              size="sm"
                              checked={bookSearchEnabled}
                              onCheckedChange={setBookSearchEnabled}
                              aria-label={t('bookSearchTool')}
                            />
                          </div>
                          
                          <div className="pt-2 pb-1 border-t border-stone-200/50 dark:border-stone-800/50 mt-1 mb-1">
                            <button
                              type="button"
                              onClick={() => setBuiltinsExpanded((v) => !v)}
                              className="flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                            >
                              <span className="flex items-center gap-1.5">
                                <Blocks className="h-3.5 w-3.5" />
                                {t('builtinToolAlwaysOn')}
                              </span>
                              <ChevronDown
                                className={cn(
                                  'h-3 w-3 shrink-0 transition-transform',
                                  builtinsExpanded ? 'rotate-180' : ''
                                )}
                              />
                            </button>
                            <AnimatePresence initial={false}>
                              {builtinsExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="space-y-0.5 pt-1">
<div
                            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-stone-400 dark:text-stone-500"
                            title={t('builtinToolAlwaysOn')}
                            aria-disabled
                          >
                            <Globe className="h-3.5 w-3.5 shrink-0 opacity-70" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm">{t('webSearchTool')}</div>
                              <div className="truncate text-[10px] opacity-80">
                                {t('builtinToolAlwaysOn')}
                              </div>
                            </div>
                          </div>
                          <div
                            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-stone-400 dark:text-stone-500"
                            title={t('builtinToolAlwaysOn')}
                            aria-disabled
                          >
                            <BookOpen className="h-3.5 w-3.5 shrink-0 opacity-70" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm">{t('webReadTool')}</div>
                              <div className="truncate text-[10px] opacity-80">
                                {t('builtinToolAlwaysOn')}
                              </div>
                            </div>
                          </div>
                          <div
                            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-stone-400 dark:text-stone-500"
                            title={t('builtinToolAlwaysOn')}
                            aria-disabled
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm">{t('createFileTool')}</div>
                              <div className="truncate text-[10px] opacity-80">
                                {t('builtinToolAlwaysOn')}
                              </div>
                            </div>
                          </div>
                          
                          
                          
                          <div
                            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-stone-400 dark:text-stone-500"
                            title={t('fileReadToolHint')}
                            aria-disabled
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm">{t('fileReadTool')}</div>
                              <div className="truncate text-[10px] opacity-80">
                                {t('fileReadToolHint')}
                              </div>
                            </div>
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
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
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
                          className="absolute bottom-0 left-[calc(100%+6px)] z-10 max-h-[min(22rem,calc(100dvh-5.5rem))] w-60 overflow-y-auto overflow-x-hidden rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md max-sm:bottom-[calc(100%+6px)] max-sm:left-0 dark:border-stone-700 dark:bg-stone-900/95"
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

          <ComposerModelMenu
            isModelMenuOpen={isModelMenuOpen}
            setIsModelMenuOpen={setIsModelMenuOpen}
            modelMenuRef={modelMenuRef}
            modelSearchRef={modelSearchRef}
            modelSearchQuery={modelSearchQuery}
            setModelSearchQuery={setModelSearchQuery}
            modelsLoading={modelsLoading}
            selectedModel={selectedModel}
            availableModels={availableModels}
            filteredModels={filteredModels}
            hasImages={hasImages}
            zhipuVisionOn={zhipuVisionOn}
            isAccountBound={isAccountBound}
            setActiveMcpIds={setActiveMcpIds}
            setSelectedModel={setSelectedModel}
            openLoginModal={openLoginModal}
          />
          </div>

        <div className="flex items-center gap-2">
          {isActiveLoading || researchBusy ? (
            <Button 
              onClick={() => (researchBusy ? cancelResearch() : stopGenerating())}
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
