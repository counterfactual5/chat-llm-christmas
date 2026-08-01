'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  Download,
  Maximize2,
  PanelRightClose,
  Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FilePreviewContent } from '@/components/files/FilePreviewOverlay';
import type {
  ExternalReferenceSourceKind,
  WebSearchSource,
} from '@/lib/chat/types';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  OutputPanel,
  type GeneratedFileEntry,
  type GeneratedImageEntry,
} from './OutputPanel';
import { ReferencePanel } from './ReferencePanel';

/** What the side panel is currently showing in "detail" (master-detail) mode. */
export type PanelPreview =
  | { kind: 'image'; entry: GeneratedImageEntry }
  | { kind: 'file'; entry: GeneratedFileEntry };

const SYSTEM_PRESETS = [
  { label: 'Concise', value: 'Answer concisely. Prefer short, direct sentences and skip preamble.' },
  { label: 'Chinese', value: '始终使用简体中文回答，除代码与专有名词外不要混用英文。' },
  { label: 'Engineer', value: 'You are a senior engineer. Give production-ready code, name tradeoffs, and flag edge cases.' },
  { label: 'Explain', value: 'Explain step by step with concrete examples, assuming a smart beginner.' },
];

type ReferenceGroup = {
  kind: ExternalReferenceSourceKind;
  sources: WebSearchSource[];
};

export type ChatContextPanelProps = {
  open: boolean;
  onClose: () => void;

  picturesExpanded: boolean;
  onTogglePicturesExpanded: () => void;
  outputGroupsOpen: Record<string, boolean>;
  onToggleOutputGroup: (key: 'images' | 'files') => void;
  images: GeneratedImageEntry[];
  files: GeneratedFileEntry[];
  onPreviewImage: (entry: GeneratedImageEntry) => void;
  onPreviewFile: (entry: GeneratedFileEntry) => void;
  onScrollToMessage: (messageId: string) => void;
  onDownloadImage: (entry: GeneratedImageEntry) => void;
  onRemoveImage: (entry: GeneratedImageEntry) => void;
  onDownloadFile: (entry: GeneratedFileEntry) => void;
  onRemoveFile: (entry: GeneratedFileEntry) => void;

  /** Master-detail preview shown in place of the list when a file/image is opened. */
  preview: PanelPreview | null;
  onClosePreview: () => void;
  onExpandPreview: () => void;
  onJumpToPreviewMessage: () => void;
  onDownloadPreview: () => void;

  referenceExpanded: boolean;
  onToggleReferenceExpanded: () => void;
  referenceGroupsOpen: Record<string, boolean>;
  onToggleReferenceGroup: (key: string) => void;
  userUploadReferences: WebSearchSource[];
  referenceSourceGroups: ReferenceGroup[];
  webSourcesCount: number;
  onOpenUploadReference: (source: WebSearchSource) => void;
  onRequestClearSources: () => void;

  systemPromptExpanded: boolean;
  onToggleSystemPromptExpanded: () => void;
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;

  messagesCount: number;
  selectedModel: string;
  contextLimit: number | null | undefined;
  usableLimit: number | null;
  usageRatio: number | null;
  estimatedTokens: number;
  contextSources: Array<[string, number]>;
  isCompacting: boolean;
  canCompact: boolean;
  onCompact: () => void;
};

export function ChatContextPanel({
  open,
  onClose,
  picturesExpanded,
  onTogglePicturesExpanded,
  outputGroupsOpen,
  onToggleOutputGroup,
  images,
  files,
  onPreviewImage,
  onPreviewFile,
  onScrollToMessage,
  onDownloadImage,
  onRemoveImage,
  onDownloadFile,
  onRemoveFile,
  preview,
  onClosePreview,
  onExpandPreview,
  onJumpToPreviewMessage,
  onDownloadPreview,
  referenceExpanded,
  onToggleReferenceExpanded,
  referenceGroupsOpen,
  onToggleReferenceGroup,
  userUploadReferences,
  referenceSourceGroups,
  webSourcesCount,
  onOpenUploadReference,
  onRequestClearSources,
  systemPromptExpanded,
  onToggleSystemPromptExpanded,
  systemPrompt,
  onSystemPromptChange,
  messagesCount,
  selectedModel,
  contextLimit,
  usableLimit,
  usageRatio,
  estimatedTokens,
  contextSources,
  isCompacting,
  canCompact,
  onCompact,
}: ChatContextPanelProps) {
  const { t } = useLocale();
  const previewFile =
    preview?.kind === 'file' && typeof preview.entry.content === 'string'
      ? {
          id: preview.entry.id,
          name: preview.entry.name,
          mimeType: preview.entry.mimeType,
          content: preview.entry.content,
          size: preview.entry.size,
        }
      : null;
  const previewTitle =
    preview?.kind === 'image' ? preview.entry.prompt || 'Image' : preview?.entry.name;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: preview ? 460 : 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ width: { duration: 0.2, ease: 'easeInOut' } }}
          className="h-full shrink-0 border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 flex flex-col overflow-hidden"
        >
          <div className="flex h-14 items-center justify-between gap-2 px-4 border-b border-stone-200/50 dark:border-stone-800/50 shrink-0">
            {preview ? (
              <button
                type="button"
                onClick={onClosePreview}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-medium text-stone-700 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
              >
                <ChevronLeft className="h-4 w-4 shrink-0 opacity-60" />
                <span className="truncate">{previewTitle}</span>
              </button>
            ) : (
              <span className="font-semibold text-stone-700 dark:text-stone-300 text-sm">Context</span>
            )}
            <div className="flex shrink-0 items-center gap-0.5">
              {preview && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('viewInChat')}
                    onClick={onJumpToPreviewMessage}
                    className="h-8 w-8 text-stone-500"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('expandFullscreen')}
                    onClick={onExpandPreview}
                    className="h-8 w-8 text-stone-500"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('download')}
                    onClick={onDownloadPreview}
                    className="h-8 w-8 text-stone-500"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-stone-500">
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {preview ? (
            <ScrollArea className="flex-1">
              {preview.kind === 'image' ? (
                <div className="flex items-center justify-center p-4">
                  <img
                    src={preview.entry.url}
                    alt={preview.entry.prompt}
                    className="max-w-full rounded-lg border border-stone-200 dark:border-stone-800"
                  />
                </div>
              ) : previewFile ? (
                <div className="px-4 py-4">
                  <FilePreviewContent file={previewFile} />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-xs text-stone-400">
                  <span>{t('noPreviewAvailable')}</span>
                </div>
              )}
            </ScrollArea>
          ) : (
          <ScrollArea className="flex-1 px-4 py-4">
            <div className="space-y-2">
              <OutputPanel
                expanded={picturesExpanded}
                onToggleExpanded={onTogglePicturesExpanded}
                groupsOpen={outputGroupsOpen}
                onToggleGroup={onToggleOutputGroup}
                images={images}
                files={files}
                onPreviewImage={onPreviewImage}
                onPreviewFile={onPreviewFile}
                onScrollToMessage={onScrollToMessage}
                onDownloadImage={onDownloadImage}
                onRemoveImage={onRemoveImage}
                onDownloadFile={onDownloadFile}
                onRemoveFile={onRemoveFile}
              />

              <ReferencePanel
                expanded={referenceExpanded}
                onToggleExpanded={onToggleReferenceExpanded}
                groupsOpen={referenceGroupsOpen}
                onToggleGroup={onToggleReferenceGroup}
                userUploadReferences={userUploadReferences}
                referenceSourceGroups={referenceSourceGroups}
                webSourcesCount={webSourcesCount}
                onOpenUploadReference={onOpenUploadReference}
                onRequestClearSources={onRequestClearSources}
              />

              {/* System Prompt — collapsible */}
              <div className="rounded-xl border border-stone-200/80 dark:border-stone-800 overflow-hidden">
                <button
                  type="button"
                  onClick={onToggleSystemPromptExpanded}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50"
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500">
                    <Settings2 className="h-3.5 w-3.5" />
                    System Prompt
                  </span>
                  <div className="flex items-center gap-1">
                    {systemPrompt.trim() && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSystemPromptChange('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            onSystemPromptChange('');
                          }
                        }}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-stone-400 hover:text-red-500"
                      >
                        Reset
                      </span>
                    )}
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 text-stone-400 transition-transform',
                        systemPromptExpanded && 'rotate-180',
                      )}
                    />
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {systemPromptExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-2 border-t border-stone-200/70 px-3 py-2.5 dark:border-stone-800">
                        <div className="flex flex-wrap gap-1.5">
                          {SYSTEM_PRESETS.map((preset) => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => onSystemPromptChange(preset.value)}
                              className={cn(
                                'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                                systemPrompt === preset.value
                                  ? 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300'
                                  : 'border-stone-200 text-stone-500 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800',
                              )}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <Textarea
                          value={systemPrompt}
                          onChange={(e) => onSystemPromptChange(e.target.value)}
                          placeholder="You are a helpful AI..."
                          className="min-h-24 border-stone-200 bg-stone-50 text-xs dark:border-stone-800 dark:bg-stone-900/50"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </ScrollArea>
          )}

          <div className="p-4 border-t border-stone-200/50 dark:border-stone-800/50 shrink-0 bg-stone-50 dark:bg-stone-900/50 text-xs text-stone-500 space-y-1.5">
            <div className="flex justify-between">
              <span>Messages</span>
              <span className="font-mono text-stone-700 dark:text-stone-300">{messagesCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Model window</span>
              <span className="font-mono text-stone-700 dark:text-stone-300 text-right">
                {contextLimit != null ? (
                  <>
                    {contextLimit.toLocaleString()}
                    <span className="block text-[10px] font-sans font-normal text-stone-400 truncate max-w-[140px]">
                      {selectedModel || '—'}
                    </span>
                  </>
                ) : (
                  'unknown'
                )}
              </span>
            </div>

            {usableLimit != null && (
              <div className="pt-1.5 space-y-1.5 border-t border-stone-200/60 dark:border-stone-800/60">
                <div className="flex justify-between font-medium">
                  <span>Context used</span>
                  <span
                    className={cn(
                      'font-mono',
                      usageRatio != null && usageRatio >= 0.9
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-stone-700 dark:text-stone-300',
                    )}
                  >
                    ~{estimatedTokens.toLocaleString()} / {usableLimit.toLocaleString()}
                    {usageRatio != null && (
                      <span className="text-stone-400 font-normal">
                        {' '}
                        ({Math.round(usageRatio * 100)}%)
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      usageRatio != null && usageRatio >= 0.9 ? 'bg-amber-500' : 'bg-orange-500',
                    )}
                    style={{ width: `${Math.min((usageRatio || 0) * 100, 100)}%` }}
                  />
                </div>
                {usageRatio != null && usageRatio >= 0.85 && (
                  <button
                    type="button"
                    disabled={isCompacting || !canCompact}
                    onClick={onCompact}
                    className="w-full rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
                  >
                    {isCompacting ? 'Compacting…' : 'Compact now'}
                  </button>
                )}
              </div>
            )}

            {contextSources.length > 1 && usableLimit != null && (
              <div className="pt-1.5 space-y-1 border-t border-stone-200/60 dark:border-stone-800/60">
                {contextSources.map(([label, tokens]) => (
                  <div key={label} className="flex justify-between text-[11px]">
                    <span className="text-stone-400">{label}</span>
                    <span className="font-mono text-stone-500">
                      {tokens.toLocaleString()}
                      <span className="text-stone-400">
                        {' '}
                        ({Math.round((tokens / usableLimit) * 100)}%)
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
