'use client';

import type { RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ModelOption } from '@/lib/chat/types';
import { formatContextWindow } from '@/lib/models/specs';

type ComposerModelMenuProps = {
  isModelMenuOpen: boolean;
  setIsModelMenuOpen: (value: boolean | ((previous: boolean) => boolean)) => void;
  modelMenuRef: RefObject<HTMLDivElement | null>;
  modelSearchRef: RefObject<HTMLInputElement | null>;
  modelSearchQuery: string;
  setModelSearchQuery: (value: string | ((previous: string) => string)) => void;
  modelsLoading: boolean;
  selectedModel: string;
  availableModels: ModelOption[];
  filteredModels: ModelOption[];
  hasImages: boolean;
  zhipuVisionOn: boolean;
  isAccountBound: boolean;
  setActiveMcpIds: (value: string[] | ((previous: string[]) => string[])) => void;
  setSelectedModel: (id: string) => void;
  openLoginModal: () => void;
};

export function ComposerModelMenu({
  isModelMenuOpen,
  setIsModelMenuOpen,
  modelMenuRef,
  modelSearchRef,
  modelSearchQuery,
  setModelSearchQuery,
  modelsLoading,
  selectedModel,
  availableModels,
  filteredModels,
  hasImages,
  zhipuVisionOn,
  isAccountBound,
  setActiveMcpIds,
  setSelectedModel,
  openLoginModal,
}: ComposerModelMenuProps) {
  const { t } = useLocale();

  return (
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
            : availableModels.find((model) => model.id === selectedModel)?.id ||
              selectedModel ||
              t('selectModel')}
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
                  onChange={(event) => setModelSearchQuery(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
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
                  {isAccountBound
                    ? 'No models found. Check connection.'
                    : 'No free models available.'}
                </div>
              )}
              {modelsLoading && availableModels.length === 0 && (
                <div className="p-4 text-center text-xs text-stone-400">Loading...</div>
              )}
              {availableModels.length > 0 && filteredModels.length === 0 && (
                <div className="p-4 text-center text-xs text-stone-400">
                  No models match “{modelSearchQuery.trim()}”
                </div>
              )}
              {filteredModels.map((model) => {
                // Vision models auto-disable Image Understand. Don't trap users:
                // logged-in accounts can pick a text model again — we re-enable
                // Image Understand on select. Guests still need a Vision model.
                const blocked =
                  hasImages && !model.vision && !zhipuVisionOn && !isAccountBound;
                const softWarn = hasImages && !model.vision && isAccountBound;
                return (
                  <button
                    key={model.id}
                    disabled={blocked}
                    onClick={() => {
                      if (blocked) return;
                      if (hasImages && !model.vision && isAccountBound) {
                        setActiveMcpIds((previous) =>
                          previous.includes('zhipu-vision')
                            ? previous
                            : [...previous, 'zhipu-vision'],
                        );
                      }
                      setSelectedModel(model.id);
                      setIsModelMenuOpen(false);
                      setModelSearchQuery('');
                    }}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left gap-2',
                      blocked && 'opacity-40 cursor-not-allowed',
                      selectedModel === model.id
                        ? 'bg-stone-100 text-stone-900 font-medium dark:bg-stone-800 dark:text-stone-100'
                        : 'hover:bg-stone-100 text-stone-700 dark:text-stone-300 dark:hover:bg-stone-800',
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
                      <div className="truncate">{model.id}</div>
                      {blocked && (
                        <div className="text-[10px] text-stone-400">
                          {t('textOnlyNeedsVision')}
                        </div>
                      )}
                      {softWarn && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400">
                          {t('textOnlyViaImageUnderstand')}
                        </div>
                      )}
                    </div>
                    <span
                      className="text-[9px] font-mono text-stone-400 shrink-0 tabular-nums"
                      title={
                        model.context_window != null
                          ? `${model.context_window.toLocaleString()} context`
                          : 'Unknown context'
                      }
                    >
                      {formatContextWindow(model.context_window)}
                    </span>
                    {model.vision && (
                      <span
                        title="Vision"
                        className="text-[8px] font-semibold leading-none rounded border border-stone-200 bg-stone-50 px-1 py-px text-stone-500 shrink-0 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400"
                      >
                        V
                      </span>
                    )}
                    {model.tier === 'paid' ? (
                      <span className="text-[8px] font-semibold leading-none rounded bg-orange-500 px-1 py-px text-white shrink-0">
                        Pro
                      </span>
                    ) : (
                      <span className="text-[8px] font-semibold leading-none rounded border border-orange-200 bg-orange-50 px-1 py-px text-orange-700 shrink-0 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-300">
                        Free
                      </span>
                    )}
                    {selectedModel === model.id && (
                      <Check className="h-3.5 w-3.5 text-stone-500 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
            {!isAccountBound && (
              <div className="shrink-0 border-t border-stone-100 p-2 dark:border-stone-800">
                <button
                  onClick={() => {
                    setIsModelMenuOpen(false);
                    setModelSearchQuery('');
                    openLoginModal();
                  }}
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
  );
}
