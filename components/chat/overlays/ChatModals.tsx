'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X, ScrollText } from 'lucide-react';
import { BrandMark } from '@/components/branding/BrandMark';
import { NotionLogo } from '@/components/integrations/logos/NotionLogo';
import { GitHubLogo } from '@/components/integrations/logos/GitHubLogo';
import { GoogleLogo } from '@/components/integrations/logos/GoogleLogo';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ImagePreviewOverlay } from '@/components/files/AttachmentImageThumb';
import {
  FilePreviewOverlay,
  type FilePreviewPayload,
} from '@/components/files/FilePreviewOverlay';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { SkillItem } from '@/lib/chat/types';
import type { GeneratedFileEntry } from '../panels/OutputPanel';

export type IntegrationStatus = {
  connected: boolean;
  available?: boolean;
  label?: string;
} | null;

export type ChatModalsProps = {
  confirmClearSourcesOpen: boolean;
  setConfirmClearSourcesOpen: (v: boolean) => void;
  clearWebSources: () => void;

  sessionPendingDelete: { id: string; title: string } | null;
  setSessionPendingDelete: (v: { id: string; title: string } | null) => void;
  deleteSession: (id: string) => void;

  skillPendingDelete: SkillItem | null;
  setSkillPendingDelete: (v: SkillItem | null) => void;
  isDeletingSkill: boolean;
  confirmDeleteSkill: () => void | Promise<void>;

  showSkillModal: boolean;
  setShowSkillModal: (v: boolean) => void;
  skillDraftTitle: string;
  setSkillDraftTitle: (v: string) => void;
  skillDraftContent: string;
  setSkillDraftContent: (v: string) => void;
  skillModalError: string;
  isSavingSkill: boolean;
  onSaveSkill: () => void | Promise<void>;

  showAuthModal: boolean;
  authModalMode: 'login' | 'notion' | 'github' | 'google';
  closeAuthModal: () => void;
  isAccountBound: boolean;
  notionStatus: IntegrationStatus;
  githubStatus: IntegrationStatus;
  googleStatus: IntegrationStatus;
  notionBusy: boolean;
  githubBusy: boolean;
  googleBusy: boolean;
  disconnectNotion: () => void | Promise<void>;
  disconnectGitHub: () => void | Promise<void>;
  disconnectGoogle: () => void | Promise<void>;
  showApiKeyLogin: boolean;
  setShowApiKeyLogin: (v: boolean | ((prev: boolean) => boolean)) => void;
  tempKeyInput: string;
  setTempKeyInput: (v: string) => void;
  accountError: string;
  accountSaving: boolean;
  saveUserKey: () => void | Promise<void>;

  imagePreviewSrc: string | null;
  setImagePreviewSrc: (v: string | null) => void;
  filePreview: FilePreviewPayload | null;
  setFilePreview: (v: FilePreviewPayload | null) => void;
  downloadGeneratedFile: (entry: GeneratedFileEntry) => void | Promise<void>;
};

export function ChatModals(props: ChatModalsProps) {
  const { t } = useLocale();
  const {
    confirmClearSourcesOpen,
    setConfirmClearSourcesOpen,
    clearWebSources,
    sessionPendingDelete,
    setSessionPendingDelete,
    deleteSession,
    skillPendingDelete,
    setSkillPendingDelete,
    isDeletingSkill,
    confirmDeleteSkill,
    showSkillModal,
    setShowSkillModal,
    skillDraftTitle,
    setSkillDraftTitle,
    skillDraftContent,
    setSkillDraftContent,
    skillModalError,
    isSavingSkill,
    onSaveSkill,
    showAuthModal,
    authModalMode,
    closeAuthModal,
    isAccountBound,
    notionStatus,
    githubStatus,
    googleStatus,
    notionBusy,
    githubBusy,
    googleBusy,
    disconnectNotion,
    disconnectGitHub,
    disconnectGoogle,
    showApiKeyLogin,
    setShowApiKeyLogin,
    tempKeyInput,
    setTempKeyInput,
    accountError,
    accountSaving,
    saveUserKey,
    imagePreviewSrc,
    setImagePreviewSrc,
    filePreview,
    setFilePreview,
    downloadGeneratedFile,
  } = props;

  return (
    <>
{/* --- Clear Reference Sources Modal --- */}
<AnimatePresence>
  {confirmClearSourcesOpen && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={() => setConfirmClearSourcesOpen(false)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-900"
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="text-base font-semibold text-stone-900 dark:text-stone-100">
            {t('clearSourcesTitle')}
          </div>
          <button
            type="button"
            onClick={() => setConfirmClearSourcesOpen(false)}
            className="text-stone-400 hover:text-stone-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm leading-relaxed text-stone-500 dark:text-stone-400">
          {t('clearSourcesConfirm')}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmClearSourcesOpen(false)}
            className="rounded-xl"
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={clearWebSources}
            className="rounded-xl bg-red-500 text-white hover:bg-red-600"
          >
            {t('clearWebSources')}
          </Button>
        </div>
      </motion.div>
    </div>
  )}
</AnimatePresence>

{/* --- Delete Chat Modal --- */}
<AnimatePresence>
  {sessionPendingDelete && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={() => setSessionPendingDelete(null)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-900"
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="text-base font-semibold text-stone-900 dark:text-stone-100">
            {t('deleteConversation')}
          </div>
          <button
            type="button"
            onClick={() => setSessionPendingDelete(null)}
            className="text-stone-400 hover:text-stone-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm leading-relaxed text-stone-500 dark:text-stone-400">
          {t('deleteConversationConfirm', { title: sessionPendingDelete.title })}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setSessionPendingDelete(null)}
            className="rounded-xl"
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => deleteSession(sessionPendingDelete.id)}
            className="rounded-xl bg-red-500 text-white hover:bg-red-600"
          >
            {t('delete')}
          </Button>
        </div>
      </motion.div>
    </div>
  )}
</AnimatePresence>

{/* --- Delete Skill Modal --- */}
<AnimatePresence>
  {skillPendingDelete && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-900"
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="text-base font-semibold text-stone-900 dark:text-stone-100">
            {t('deleteSkill')}
          </div>
          <button
            type="button"
            onClick={() => !isDeletingSkill && setSkillPendingDelete(null)}
            className="text-stone-400 hover:text-stone-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm leading-relaxed text-stone-500 dark:text-stone-400">
          {t('deleteSkillConfirm', { title: skillPendingDelete.title })}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={isDeletingSkill}
            onClick={() => setSkillPendingDelete(null)}
            className="rounded-xl"
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={isDeletingSkill}
            onClick={confirmDeleteSkill}
            className="rounded-xl bg-red-500 text-white hover:bg-red-600"
          >
            {isDeletingSkill ? '删除中…' : '删除'}
          </Button>
        </div>
      </motion.div>
    </div>
  )}
</AnimatePresence>

{/* --- New Skill Modal --- */}
<AnimatePresence>
  {showSkillModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-base font-semibold">
            <ScrollText className="h-5 w-5 text-orange-500" />
            {t('newSkill')}
          </div>
          <button
            type="button"
            onClick={() => setShowSkillModal(false)}
            className="text-stone-400 hover:text-stone-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">
              名称
            </label>
            <input
              value={skillDraftTitle}
              onChange={(e) => setSkillDraftTitle(e.target.value)}
              placeholder="Skill 名称"
              className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-orange-400 dark:border-stone-700 dark:bg-stone-900/60"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">
              系统提示词
            </label>
            <Textarea
              value={skillDraftContent}
              onChange={(e) => setSkillDraftContent(e.target.value)}
              placeholder="模型每轮都会遵守的角色、语气、约束…"
              className="min-h-36 text-sm bg-stone-50 dark:bg-stone-900/60 border-stone-200 dark:border-stone-700"
            />
          </div>

          {skillModalError && (
            <p className="text-xs text-red-600 dark:text-red-400">{skillModalError}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowSkillModal(false)}
              className="rounded-xl"
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void onSaveSkill()}
              disabled={isSavingSkill || !skillDraftTitle.trim() || !skillDraftContent.trim()}
              className="rounded-xl bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
            >
              {isSavingSkill ? '保存中…' : '保存到账号'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  )}
</AnimatePresence>

{/* --- Login / Notion Modal --- */}
<AnimatePresence>
  {showAuthModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl dark:border-stone-800 dark:bg-stone-900"
      >
        <button
          type="button"
          onClick={closeAuthModal}
          className="absolute right-4 top-4 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
          aria-label={t('cancel')}
        >
          <X className="h-5 w-5" />
        </button>

        {authModalMode === 'notion' && isAccountBound ? (
          <section className="flex flex-col items-center px-1 pt-2 pb-1 text-center">
            <NotionLogo className="mx-auto h-14 w-14 rounded-2xl shadow-sm" />
            <h2 className="mt-5 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
              {t('notionConnectCardTitle')}
            </h2>
            {notionStatus?.connected ? (
              <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
                {t('notionConnected')}
                {notionStatus.label ? ` · ${notionStatus.label}` : ''}
              </p>
            ) : notionStatus?.available === false ? (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                {t('notionNotConfigured')}
              </p>
            ) : (
              <p className="mt-2 max-w-sm text-sm leading-6 text-stone-500 dark:text-stone-400">
                {t('notionConnectCardBody')}
              </p>
            )}

            <div className="mt-6 w-full max-w-sm">
              {notionStatus?.connected ? (
                <Button
                  type="button"
                  disabled={notionBusy}
                  onClick={() => void disconnectNotion()}
                  className="h-11 w-full rounded-xl border border-red-200 bg-white text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-stone-700 dark:bg-stone-800 dark:text-red-300/90 dark:hover:border-stone-600 dark:hover:bg-stone-700 dark:hover:text-red-200"
                >
                  {t('disconnectNotion')}
                </Button>
              ) : (
                <a
                  href={
                    notionStatus?.available === false
                      ? undefined
                      : '/api/integrations/notion/start'
                  }
                  aria-disabled={notionStatus?.available === false}
                  onClick={(e) => {
                    if (notionStatus?.available === false) e.preventDefault();
                  }}
                  className={cn(
                    'inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold transition-colors',
                    notionStatus?.available === false
                      ? 'cursor-not-allowed bg-stone-200 text-stone-400 dark:bg-stone-800'
                      : 'bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white',
                  )}
                >
                  {t('connectNotion')}
                </a>
              )}
            </div>
            {accountError ? (
              <p className="mt-4 w-full text-sm text-red-600 dark:text-red-400">
                {accountError}
              </p>
            ) : null}
          </section>
        ) : authModalMode === 'github' && isAccountBound ? (
          <section className="flex flex-col items-center px-1 pt-2 pb-1 text-center">
            <GitHubLogo className="mx-auto h-14 w-14 rounded-2xl p-2 shadow-sm" />
            <h2 className="mt-5 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
              {t('githubConnectCardTitle')}
            </h2>
            {githubStatus?.connected ? (
              <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
                {t('githubConnected')}
                {githubStatus.label ? ` · ${githubStatus.label}` : ''}
              </p>
            ) : githubStatus?.available === false ? (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                {t('githubNotConfigured')}
              </p>
            ) : (
              <p className="mt-2 max-w-sm text-sm leading-6 text-stone-500 dark:text-stone-400">
                {t('githubConnectCardBody')}
              </p>
            )}

            <div className="mt-6 w-full max-w-sm">
              {githubStatus?.connected ? (
                <Button
                  type="button"
                  disabled={githubBusy}
                  onClick={() => void disconnectGitHub()}
                  className="h-11 w-full rounded-xl border border-red-200 bg-white text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-stone-700 dark:bg-stone-800 dark:text-red-300/90 dark:hover:border-stone-600 dark:hover:bg-stone-700 dark:hover:text-red-200"
                >
                  {t('disconnectGitHub')}
                </Button>
              ) : (
                <a
                  href={
                    githubStatus?.available === false
                      ? undefined
                      : '/api/integrations/github/start'
                  }
                  aria-disabled={githubStatus?.available === false}
                  onClick={(e) => {
                    if (githubStatus?.available === false) e.preventDefault();
                  }}
                  className={cn(
                    'inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold transition-colors',
                    githubStatus?.available === false
                      ? 'cursor-not-allowed bg-stone-200 text-stone-400 dark:bg-stone-800'
                      : 'bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white',
                  )}
                >
                  {t('connectGitHub')}
                </a>
              )}
            </div>
            {accountError ? (
              <p className="mt-4 w-full text-sm text-red-600 dark:text-red-400">
                {accountError}
              </p>
            ) : null}
          </section>
        ) : authModalMode === 'google' && isAccountBound ? (
          <section className="flex flex-col items-center px-1 pt-2 pb-1 text-center">
            <GoogleLogo className="mx-auto h-14 w-14 rounded-2xl p-2 shadow-sm" />
            <h2 className="mt-5 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
              {t('googleConnectCardTitle')}
            </h2>
            {googleStatus?.connected ? (
              <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
                {t('googleConnected')}
                {googleStatus.label ? ` · ${googleStatus.label}` : ''}
              </p>
            ) : googleStatus?.available === false ? (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                {t('googleNotConfigured')}
              </p>
            ) : (
              <p className="mt-2 max-w-sm text-sm leading-6 text-stone-500 dark:text-stone-400">
                {t('googleConnectCardBody')}
              </p>
            )}

            <div className="mt-6 w-full max-w-sm">
              {googleStatus?.connected ? (
                <Button
                  type="button"
                  disabled={googleBusy}
                  onClick={() => void disconnectGoogle()}
                  className="h-11 w-full rounded-xl border border-red-200 bg-white text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-stone-700 dark:bg-stone-800 dark:text-red-300/90 dark:hover:border-stone-600 dark:hover:bg-stone-700 dark:hover:text-red-200"
                >
                  {t('disconnectGoogle')}
                </Button>
              ) : (
                <a
                  href={
                    googleStatus?.available === false
                      ? undefined
                      : '/api/integrations/google/start'
                  }
                  aria-disabled={googleStatus?.available === false}
                  onClick={(e) => {
                    if (googleStatus?.available === false) e.preventDefault();
                  }}
                  className={cn(
                    'inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold transition-colors',
                    googleStatus?.available === false
                      ? 'cursor-not-allowed bg-stone-200 text-stone-400 dark:bg-stone-800'
                      : 'bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white',
                  )}
                >
                  {t('connectGoogle')}
                </a>
              )}
            </div>
            {accountError ? (
              <p className="mt-4 w-full text-sm text-red-600 dark:text-red-400">
                {accountError}
              </p>
            ) : null}
          </section>
        ) : (
          <section className="flex flex-col items-center px-1 pt-2 pb-1 text-center">
            <BrandMark className="h-14 w-14 rounded-2xl shadow-sm" />
            <h2 className="mt-5 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
              {t('authWelcomeTitle')}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-stone-500 dark:text-stone-400">
              {t('authWelcomeBody')}
            </p>

            <a
              href="/api/auth/start"
              className="mt-6 inline-flex h-11 w-full max-w-sm items-center justify-center rounded-xl bg-stone-900 text-sm font-semibold text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
            >
              {t('continueWithSite')}
            </a>

            <button
              type="button"
              onClick={() => setShowApiKeyLogin((v) => !v)}
              className="mt-4 text-xs font-medium text-stone-400 underline-offset-2 hover:text-stone-600 hover:underline dark:hover:text-stone-300"
            >
              {t('manualApiKeyFallback')}
            </button>

            {showApiKeyLogin ? (
              <div className="mt-4 w-full max-w-sm space-y-3 text-left">
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-400">
                  {t('apiTokenLabel')}
                </label>
                <input
                  type="password"
                  value={tempKeyInput}
                  onChange={(e) => setTempKeyInput(e.target.value)}
                  placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-stone-800"
                />
                <Button
                  onClick={saveUserKey}
                  disabled={accountSaving || !tempKeyInput.trim()}
                  className="h-10 w-full rounded-xl bg-stone-800 text-white hover:bg-stone-700 dark:bg-stone-200 dark:text-stone-900"
                >
                  {accountSaving ? t('validating') : t('saveAndConnect')}
                </Button>
              </div>
            ) : null}

            {accountError ? (
              <p className="mt-4 w-full text-sm text-red-600 dark:text-red-400">{accountError}</p>
            ) : null}
          </section>
        )}
      </motion.div>
    </div>
  )}
</AnimatePresence>

<ImagePreviewOverlay src={imagePreviewSrc} onClose={() => setImagePreviewSrc(null)} />
<FilePreviewOverlay
  file={filePreview}
  onClose={() => setFilePreview(null)}
  onDownload={(file) =>
    void downloadGeneratedFile({
      messageId: '',
      fileIndex: 0,
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size || 0,
      url: `local://${file.id}`,
      content: file.content,
      createdAt: Date.now(),
    })
  }
  labels={{
    preview: t('previewFile'),
    download: t('download'),
    close: t('closePreview'),
  }}
/>
    </>
  );
}
