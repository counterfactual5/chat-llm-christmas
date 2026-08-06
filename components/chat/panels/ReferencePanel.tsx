'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, FileText, Quote } from 'lucide-react';
import type {
  ExternalReferenceSourceKind,
  WebSearchSource,
} from '@/lib/chat/types';
import { useLocale } from '@/lib/i18n';
import {
  isPreviewableHttpUrl,
  shouldOpenLinkExternally,
} from '@/lib/files/url-preview';
import { cn } from '@/lib/utils';

type ReferenceGroup = {
  kind: ExternalReferenceSourceKind;
  sources: WebSearchSource[];
};

type ReferencePanelProps = {
  expanded: boolean;
  onToggleExpanded: () => void;
  groupsOpen: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
  userUploadReferences: WebSearchSource[];
  referenceSourceGroups: ReferenceGroup[];
  webSourcesCount: number;
  onOpenUploadReference: (source: WebSearchSource) => void;
  /** Open a web/source URL in the side Preview panel. */
  onOpenWebSource?: (source: WebSearchSource) => void;
  onRequestClearSources: () => void;
};

const GROUP_LABEL_KEY: {
  [K in ExternalReferenceSourceKind]:
    | 'webSearchGroup'
    | 'notionGroup'
    | 'githubGroup'
    | 'gmailGroup'
    | 'calendarGroup'
    | 'driveGroup'
    | 'googleGroup';
} = {
  web: 'webSearchGroup',
  notion: 'notionGroup',
  github: 'githubGroup',
  gmail: 'gmailGroup',
  calendar: 'calendarGroup',
  drive: 'driveGroup',
  google: 'googleGroup',
};

export function ReferencePanel({
  expanded,
  onToggleExpanded,
  groupsOpen,
  onToggleGroup,
  userUploadReferences,
  referenceSourceGroups,
  webSourcesCount,
  onOpenUploadReference,
  onOpenWebSource,
  onRequestClearSources,
}: ReferencePanelProps) {
  const { t } = useLocale();
  const total = userUploadReferences.length + webSourcesCount;

  return (
    <div className="rounded-xl border border-stone-200/80 dark:border-stone-800 overflow-hidden">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500">
          <Quote className="h-3.5 w-3.5" />
          {t('referenceMaterial')}
          {total > 0 && (
            <span className="rounded-md bg-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {total}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-stone-400 transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="max-h-64 min-w-0 space-y-3 overflow-x-hidden overflow-y-auto border-t border-stone-200/70 px-3 py-2.5 dark:border-stone-800">
              {userUploadReferences.length > 0 && (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => onToggleGroup('uploads')}
                    className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800/80"
                  >
                    <span>
                      {t('uploadedReferenceFiles')} · {userUploadReferences.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 transition-transform',
                        groupsOpen.uploads && 'rotate-180',
                      )}
                    />
                  </button>
                  {groupsOpen.uploads && (
                    <ul className="space-y-1">
                      {userUploadReferences.map((src) => {
                        const isImg = src.kind === 'image';
                        return (
                          <li key={`${src.messageId || 'pending'}-${src.title}-${src.url}`}>
                            <button
                              type="button"
                              onClick={() => onOpenUploadReference(src)}
                              className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-100 dark:hover:bg-stone-800/80"
                            >
                              {isImg && src.url ? (
                                <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-stone-200 dark:bg-stone-800">
                                  <img src={src.url} alt="" className="h-full w-full object-cover" />
                                </span>
                              ) : (
                                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-stone-700 dark:text-stone-200">
                                  {src.title}
                                </span>
                                {src.snippet ? (
                                  <span className="mt-0.5 block line-clamp-3 whitespace-pre-wrap text-[11px] leading-4 text-stone-500">
                                    {src.snippet}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
              {referenceSourceGroups.length > 0 && (
                <div
                  className={cn(
                    'space-y-1.5',
                    userUploadReferences.length > 0 &&
                      'border-t border-stone-100 pt-2 dark:border-stone-800',
                  )}
                >
                  <div className="flex items-center justify-between gap-2 px-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                      {t('searchedSources')}
                    </span>
                    <button
                      type="button"
                      onClick={onRequestClearSources}
                      className="text-[10px] text-stone-400 hover:text-red-500"
                    >
                      {t('clearWebSources')}
                    </button>
                  </div>
                  {referenceSourceGroups.map((group) => {
                    const groupLabel = GROUP_LABEL_KEY[group.kind];
                    const isOpen = Boolean(groupsOpen[group.kind]);
                    return (
                      <div
                        key={group.kind}
                        className="rounded-md bg-stone-50/70 dark:bg-stone-900/40"
                      >
                        <button
                          type="button"
                          onClick={() => onToggleGroup(group.kind)}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800/80"
                        >
                          <span>
                            {t(groupLabel)} · {group.sources.length}
                          </span>
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 text-stone-400 transition-transform',
                              isOpen && 'rotate-180',
                            )}
                          />
                        </button>
                        {isOpen && (
                          <ul className="space-y-1 px-1.5 pb-1.5">
                            {group.sources.map((src) => (
                              <li key={src.url}>
                                <a
                                  href={src.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block truncate rounded-md px-1.5 py-1 text-xs text-stone-600 hover:bg-stone-100 hover:underline dark:text-stone-300 dark:hover:bg-stone-800/80"
                                  title={src.snippet || src.title}
                                  onClick={(e) => {
                                    if (
                                      !onOpenWebSource ||
                                      !isPreviewableHttpUrl(src.url)
                                    ) {
                                      return;
                                    }
                                    if (shouldOpenLinkExternally(e)) return;
                                    e.preventDefault();
                                    onOpenWebSource(src);
                                  }}
                                >
                                  {src.title || src.url}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
