'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus,
  Terminal,
  Image as ImageIcon,
  ShieldCheck,
  Play,
  Sparkles,
  ScrollText,
  Check,
  X,
  Blocks,
  FileText,
  SlidersHorizontal,
  ChevronDown,
  FlaskConical,
  BookOpen,
  GraduationCap,
  Loader2,
  MoreHorizontal,
  Clock,
  Download,
  Trash2,
  Globe,
  Monitor,
  Sun,
  Moon,
  LogOut,
  Key,
  Brain,
} from 'lucide-react';
import { BrandMark } from '@/components/branding/BrandMark';
import { NotionLogo } from '@/components/integrations/logos/NotionLogo';
import { GitHubLogo } from '@/components/integrations/logos/GitHubLogo';
import { GoogleLogo } from '@/components/integrations/logos/GoogleLogo';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { useLocale } from '@/lib/i18n';
import { useTheme } from '@/components/theme/ThemeProvider';
import { cn } from '@/lib/utils';
import type { ChatSession, SkillItem } from '@/lib/chat/types';
import {
  buildSidebarDayGroups,
  dayKeyOf,
  formatDayGroupLabel,
  sessionsForSidebar,
} from '@/lib/chat/context/sidebar';

export type ChatSidebarProps = {
  open: boolean;
  sessions: ChatSession[];
  activeSessionId: string;
  isSessionLoading: (sessionId: string) => boolean;
  skills: SkillItem[];
  activeSkillIds: string[];
  autoReviewEnabled: boolean;
  modelSupportsVision: boolean;
  isAccountBound: boolean;
  accountDisplayName: string;
  canContinue: boolean;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRequestDeleteSession: (sessionId: string, title: string) => void;
  onExportSession: (sessionId: string, e: React.MouseEvent) => void;
  onInsertImageCommand: () => void;
  onInsertSkillCommand: () => void;
  onInsertResearchCommand: () => void;
  onInsertPapersCommand: () => void;
  onInsertBooksCommand: () => void;
  onRequestClaimReview: () => void;
  onContinueReply: () => void;
  onOpenNewSkillModal: () => void;
  onPreviewSkill: (skill: SkillItem) => void;
  onToggleSkill: (skillId: string) => void;
  onRequestDeleteSkill: (skillId: string, e: React.MouseEvent) => void;
  onFetchSkills: () => void;
  onFetchIntegrations: () => void;
  onOpenNotionModal: () => void;
  onOpenGitHubModal: () => void;
  onOpenGoogleModal: () => void;
  onOpenFilesModal: () => void;
  onOpenMemoriesModal: () => void;
  onOpenLoginModal: () => void;
  onSetAutoReview: (enabled: boolean) => void;
  onDisconnectAccount: () => void | Promise<void>;
};

export function ChatSidebar({
  open,
  sessions,
  activeSessionId,
  isSessionLoading,
  skills,
  activeSkillIds,
  autoReviewEnabled,
  modelSupportsVision,
  isAccountBound,
  accountDisplayName,
  canContinue,
  onCreateSession,
  onSelectSession,
  onRequestDeleteSession,
  onExportSession,
  onInsertImageCommand,
  onInsertSkillCommand,
  onInsertResearchCommand,
  onInsertPapersCommand,
  onInsertBooksCommand,
  onRequestClaimReview,
  onContinueReply,
  onOpenNewSkillModal,
  onPreviewSkill,
  onToggleSkill,
  onRequestDeleteSkill,
  onFetchSkills,
  onFetchIntegrations,
  onOpenNotionModal,
  onOpenGitHubModal,
  onOpenGoogleModal,
  onOpenFilesModal,
  onOpenMemoriesModal,
  onOpenLoginModal,
  onSetAutoReview,
  onDisconnectAccount,
}: ChatSidebarProps) {
  const { t, locale, setLocale } = useLocale();
  const { theme, preference, toggleTheme } = useTheme();

  const [commandsExpanded, setCommandsExpanded] = useState(false);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const [mcpExpanded, setMcpExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [pastDayOpen, setPastDayOpen] = useState<Record<string, boolean>>({});
  const [sessionMenuOpenId, setSessionMenuOpenId] = useState<string | null>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const todayKey = dayKeyOf(Date.now());
  const dayGroups = useMemo(
    () => buildSidebarDayGroups(sessionsForSidebar(sessions), todayKey),
    [sessions, todayKey],
  );

  const dayLabel = (key: string) =>
    formatDayGroupLabel(key, {
      todayKey,
      locale,
      todayLabel: t('today'),
      yesterdayLabel: t('yesterday'),
    });

  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (accountMenuRef.current && target && !accountMenuRef.current.contains(target)) {
        setIsAccountMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isAccountMenuOpen]);

  useEffect(() => {
    if (!sessionMenuOpenId) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(`[data-session-menu="${sessionMenuOpenId}"]`) ||
        target.closest(`[data-session-menu-trigger="${sessionMenuOpenId}"]`)
      ) {
        return;
      }
      setSessionMenuOpenId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSessionMenuOpenId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [sessionMenuOpenId]);

  return (
    <>
      {/* --- Sidebar --- */}
      <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-stone-200 bg-stone-100/60 dark:border-stone-800 dark:bg-stone-900/60"
        >
          <div className="flex max-h-[45%] shrink-0 flex-col gap-3 overflow-y-auto border-b border-stone-200/50 p-4 dark:border-stone-800/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 font-semibold text-[15px] tracking-tight text-stone-900 dark:text-stone-100">
                <BrandMark className="h-7 w-7 shadow-sm" />
                Christmas Chat
              </div>
            </div>

            <Button 
              onClick={onCreateSession}
              className="w-full justify-start gap-2 bg-white text-stone-700 hover:bg-stone-50 border border-stone-200 shadow-sm dark:bg-stone-800 dark:text-stone-200 dark:border-stone-700 dark:hover:bg-stone-700"
            >
              <Plus className="h-4 w-4" />
              {t('newChat')}
            </Button>

            {/* Skills entry under New Chat (ChatGPT-style tools area) */}
            <div className="space-y-1 pt-1">
              {/* Command layer — one-shot actions */}
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setCommandsExpanded((v) => !v);
                    setSkillsExpanded(false);
                    setMcpExpanded(false);
                    setToolsExpanded(false);
                  }}
                  className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Terminal className="h-4 w-4 text-stone-500" />
                    {t('commandLayer')}
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-stone-400 transition-transform',
                      commandsExpanded ? 'rotate-180' : '',
                    )}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {commandsExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden pl-2"
                    >
                      <div className="space-y-0.5 pb-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (!isAccountBound) {
                              onOpenLoginModal();
                              return;
                            }
                            onInsertImageCommand();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                        >
                          <ImageIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                          <span className="min-w-0 flex-1 truncate">{t('generateImage')}</span>
                          <span className="shrink-0 font-mono text-[10px] text-stone-400">
                            /image
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!isAccountBound) {
                              onOpenLoginModal();
                              return;
                            }
                            onInsertResearchCommand();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                        >
                          <FlaskConical className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                          <span className="min-w-0 flex-1 truncate">{t('deepResearchCommand')}</span>
                          <span className="shrink-0 font-mono text-[10px] text-stone-400">
                            /research
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!isAccountBound) {
                              onOpenLoginModal();
                              return;
                            }
                            onInsertPapersCommand();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                        >
                          <GraduationCap className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                          <span className="min-w-0 flex-1 truncate">{t('papersCommand')}</span>
                          <span className="shrink-0 font-mono text-[10px] text-stone-400">
                            /papers
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!isAccountBound) {
                              onOpenLoginModal();
                              return;
                            }
                            onInsertBooksCommand();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                        >
                          <BookOpen className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                          <span className="min-w-0 flex-1 truncate">{t('booksCommand')}</span>
                          <span className="shrink-0 font-mono text-[10px] text-stone-400">
                            /books
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!isAccountBound) {
                              onOpenLoginModal();
                              return;
                            }
                            onInsertSkillCommand();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                        >
                          <Sparkles className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                          <span className="min-w-0 flex-1 truncate">{t('createSkillCommand')}</span>
                          <span className="shrink-0 font-mono text-[10px] text-stone-400">/skill</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!isAccountBound) {
                              onOpenLoginModal();
                              return;
                            }
                            onRequestClaimReview();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                        >
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                          <span className="min-w-0 flex-1 truncate">{t('requestReview')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onContinueReply();
                          }}
                          disabled={
                            !canContinue
                          }
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-300 dark:hover:bg-stone-800/50"
                          title={t('continueCommandHint')}
                        >
                          <Play className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                          <span className="min-w-0 flex-1 truncate">{t('continueCommand')}</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => {
                    if (!isAccountBound) {
                      onOpenLoginModal();
                      return;
                    }
                    setSkillsExpanded((v) => !v);
                    setMcpExpanded(false);
                    setToolsExpanded(false);
                    setCommandsExpanded(false);
                    if (skills.length === 0) onFetchSkills();
                  }}
                  className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <ScrollText className="h-4 w-4 text-stone-500" />
                    {t('skills')}
                  </span>
                  <ChevronDown className={cn('h-3.5 w-3.5 text-stone-400 transition-transform', skillsExpanded && isAccountBound ? 'rotate-180' : '')} />
                </button>

                <AnimatePresence initial={false}>
                  {isAccountBound && skillsExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden pl-2"
                    >
                      <div className="space-y-0.5 pb-1">
                        <button
                          type="button"
                          onClick={onOpenNewSkillModal}
                          className="mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs font-medium text-stone-500 hover:bg-stone-200/50 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800/50 dark:hover:text-stone-200"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {t('newSkill')}
                        </button>

                        {skills.map((skill) => {
                          const on = activeSkillIds.includes(skill.id);
                          return (
                            <div
                              key={skill.id}
                              className="group flex items-center rounded-lg hover:bg-stone-200/60 dark:hover:bg-stone-800/60"
                            >
                              <button
                                type="button"
                                onClick={() => onPreviewSkill(skill)}
                                className={cn(
                                  'flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                                  on
                                    ? 'text-stone-900 dark:text-stone-100'
                                    : 'text-stone-600 dark:text-stone-300',
                                )}
                                title={t('previewSkill')}
                              >
                                <ScrollText className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                                <span className="truncate">{skill.title}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onToggleSkill(skill.id)}
                                className={cn(
                                  'rounded p-1 transition-colors',
                                  on
                                    ? 'text-stone-700 hover:bg-stone-200 dark:text-stone-200 dark:hover:bg-stone-700'
                                    : 'text-stone-400 hover:bg-stone-200 hover:text-stone-600 dark:hover:bg-stone-700 dark:hover:text-stone-200',
                                )}
                                title={
                                  on
                                    ? t('removeSkillFromChat')
                                    : t('addSkillToChat')
                                }
                              >
                                <Check className={cn('h-3.5 w-3.5', on ? 'opacity-100' : 'opacity-40')} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => onRequestDeleteSkill(skill.id, e)}
                                className="mr-1 rounded p-1 text-stone-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-900/20"
                                title={t('deleteSkill')}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>


              {/* MCP — same collapsible pattern as Skills; click Notion for connect/disconnect card */}
              <div>
              <button
                type="button"
                onClick={() => {
                  if (!isAccountBound) {
                    onOpenLoginModal();
                    return;
                  }
                  setMcpExpanded((v) => !v);
                  setSkillsExpanded(false);
                  setToolsExpanded(false);
                  setCommandsExpanded(false);
                  onFetchIntegrations();
                }}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50 transition-colors"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Blocks className="h-4 w-4 text-stone-500" />
                  {t('mcpTools')}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-stone-400 transition-transform',
                    mcpExpanded && isAccountBound ? 'rotate-180' : '',
                  )}
                />
              </button>

              <AnimatePresence initial={false}>
                {isAccountBound && mcpExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden pl-2"
                  >
                    <div className="space-y-0.5 pb-1">
                      <button
                        type="button"
                        onClick={() => onOpenNotionModal()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                      >
                        <NotionLogo className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">Notion</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenGitHubModal()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                      >
                        <GitHubLogo className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">GitHub</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenGoogleModal()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                      >
                        <GoogleLogo className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">Google</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              </div>

              {/* Tool layer — persistent capabilities, not MCP. */}
              <div>
              <button
                type="button"
                onClick={() => {
                  setToolsExpanded((v) => !v);
                  setMcpExpanded(false);
                  setSkillsExpanded(false);
                  setCommandsExpanded(false);
                }}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50 transition-colors"
              >
                <span className="flex items-center gap-2 font-medium">
                  <SlidersHorizontal className="h-4 w-4 text-stone-500" />
                  {t('toolLayer')}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-stone-400 transition-transform',
                    toolsExpanded ? 'rotate-180' : '',
                  )}
                />
              </button>

              <AnimatePresence initial={false}>
                {toolsExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden pl-2"
                  >
                    <div className="space-y-0.5 pb-1">
                      <div className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-stone-700 dark:text-stone-200">
                            {t('autoReview')}
                          </div>
                          <div className="truncate text-[10px] text-stone-400">
                            {t('autoReviewHint')}
                          </div>
                        </div>
                        <Switch
                          size="sm"
                          checked={autoReviewEnabled}
                          onCheckedChange={onSetAutoReview}
                          aria-label={t('autoReview')}
                        />
                      </div>
                      <div
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-stone-400 dark:text-stone-500"
                        title={
                          modelSupportsVision
                            ? t('imageUnderstandDisabledOnVision')
                            : t('zhipuVisionMcpHint')
                        }
                        aria-disabled
                      >
                        <ImageIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{t('enableZhipuVisionMcp')}</div>
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

              {/* Files — account-wide asset management. Workspace uploads/knowledge live elsewhere. */}
              <button
                type="button"
                onClick={() => {
                  if (!isAccountBound) {
                    onOpenLoginModal();
                    return;
                  }
                  onOpenFilesModal();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50 transition-colors"
              >
                <FileText className="h-4 w-4 text-stone-500" />
                <span className="font-medium">Files</span>
              </button>

              {/* Memory — account-wide durable preferences extracted from chats. */}
              <button
                type="button"
                onClick={() => {
                  if (!isAccountBound) {
                    onOpenLoginModal();
                    return;
                  }
                  onOpenMemoriesModal();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50 transition-colors"
              >
                <Brain className="h-4 w-4 text-stone-500" />
                <span className="font-medium">Memory</span>
              </button>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1 px-3 py-2">
            <div className="space-y-3">
              {dayGroups.map((group) => {
                const open = group.isToday || Boolean(pastDayOpen[group.key]);
                const label = dayLabel(group.key);
                return (
                  <div key={group.key} className="space-y-1">
                    {group.isToday ? (
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                        {label}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setPastDayOpen((prev) => ({
                            ...prev,
                            [group.key]: !prev[group.key],
                          }))
                        }
                        className="flex w-full items-center gap-1 rounded-lg px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-stone-400 hover:bg-stone-200/40 hover:text-stone-600 dark:hover:bg-stone-800/40 dark:hover:text-stone-300"
                      >
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 shrink-0 opacity-60 transition-transform',
                            open ? 'rotate-0' : '-rotate-90',
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        <span className="opacity-50">{group.sessions.length}</span>
                      </button>
                    )}
                    {open &&
                      group.sessions.map((session) => (
                        <div key={session.id} className="relative group">
                          <div
                            onClick={() => {
                              onSelectSession(session.id);
                              setSessionMenuOpenId(null);
                            }}
                            className={cn(
                              'flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
                              activeSessionId === session.id
                                ? 'bg-white text-stone-900 shadow-sm border border-stone-200 dark:bg-stone-800 dark:text-stone-100 dark:border-stone-700'
                                : 'text-stone-600 hover:bg-stone-200/50 dark:text-stone-400 dark:hover:bg-stone-800/50',
                            )}
                          >
                            <div className="flex w-full items-center gap-2 overflow-hidden pr-6">
                              <span className="min-w-0 flex-1 truncate">{session.title}</span>
                              {isSessionLoading(session.id) && (
                                <Loader2
                                  className="h-3.5 w-3.5 shrink-0 animate-spin text-orange-500"
                                  aria-label={t('generating')}
                                />
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            data-session-menu-trigger={session.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSessionMenuOpenId(
                                sessionMenuOpenId === session.id ? null : session.id,
                              );
                            }}
                            className={cn(
                              'absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md bg-transparent hover:bg-stone-200 dark:hover:bg-stone-700 transition-opacity',
                              sessionMenuOpenId === session.id
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-100',
                            )}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5 text-stone-500" />
                          </button>

                          <AnimatePresence>
                            {sessionMenuOpenId === session.id && (
                              <motion.div
                                data-session-menu={session.id}
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl dark:border-stone-700 dark:bg-stone-900"
                              >
                                <div className="px-2 py-1.5 border-b border-stone-100 dark:border-stone-800/50 mb-1 flex items-center gap-2 text-xs text-stone-400">
                                  <Clock className="h-3 w-3" />
                                  {new Date(session.updatedAt).toLocaleString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })}
                                </div>

                                <div className="px-2 py-1 text-xs text-stone-500">
                                  {session.messages.length} messages
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onExportSession(session.id, e);
                                    setSessionMenuOpenId(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100 rounded-md dark:text-stone-300 dark:hover:bg-stone-800"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  {t('exportMarkdown')}
                                </button>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSessionMenuOpenId(null);
                                    onRequestDeleteSession(session.id, session.title);
                                  }}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md dark:text-red-400 dark:hover:bg-red-900/20"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {t('deleteChat')}
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
            
            {/* Sidebar Footer: Account / Language / Theme — always pinned to bottom */}
            <div className="relative shrink-0 border-t border-stone-200/60 bg-stone-100/80 p-3 dark:border-stone-800/60 dark:bg-stone-900/80" ref={accountMenuRef}>
              <AnimatePresence>
                {isAccountMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="absolute bottom-full left-3 right-3 mb-2 z-50 overflow-hidden rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl dark:border-stone-700 dark:bg-stone-900"
                  >
                    <div className="px-2.5 py-2 border-b border-stone-100 dark:border-stone-800 mb-1">
                      <div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                        {accountDisplayName}
                      </div>
                      <div className="truncate text-[11px] text-stone-400">
                        {isAccountBound ? t('accountConnectedHint') : t('connectAccountHint')}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                    >
                      <Globe className="h-3.5 w-3.5 text-stone-400" />
                      <span className="flex-1 text-left">{t('language')}</span>
                      <span className="text-xs text-stone-400">
                        {locale === 'zh' ? t('languageZh') : t('languageEn')}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleTheme()}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                    >
                      {preference === 'system' ? (
                        <Monitor className="h-3.5 w-3.5 text-stone-400" />
                      ) : theme === 'dark' ? (
                        <Sun className="h-3.5 w-3.5 text-stone-400" />
                      ) : (
                        <Moon className="h-3.5 w-3.5 text-stone-400" />
                      )}
                      <span className="flex-1 text-left">{t('theme')}</span>
                      <span className="text-xs text-stone-400">
                        {preference === 'system'
                          ? t('themeSystem')
                          : preference === 'dark'
                            ? t('themeDark')
                            : t('themeLight')}
                      </span>
                    </button>

                    <div className="my-1 border-t border-stone-100 dark:border-stone-800" />

                    {isAccountBound ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsAccountMenuOpen(false);
                          void onDisconnectAccount();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        {t('signOut')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setIsAccountMenuOpen(false);
                          onOpenLoginModal();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                      >
                        <Key className="h-3.5 w-3.5" />
                        {t('connect')}
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="button"
                onClick={() => setIsAccountMenuOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white p-2.5 text-left transition-colors hover:bg-stone-50 hover:border-stone-300 focus-visible:ring-2 focus-visible:ring-stone-300 dark:border-stone-700 dark:bg-stone-800 dark:hover:bg-stone-700/80 dark:hover:border-stone-600 dark:focus-visible:ring-stone-600"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div
                    className={cn(
                      'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-stone-100 text-stone-700',
                      'border-stone-200 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200',
                    )}
                  >
                    <Key className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-stone-800 dark:text-stone-100">
                      {accountDisplayName}
                    </div>
                    <div className="truncate text-[10px] text-stone-400">
                      {isAccountBound ? t('accountConnectedHint') : t('connectAccountHint')}
                    </div>
                  </div>
                </div>
                <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform', isAccountMenuOpen && 'rotate-180')} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>

  );
}
