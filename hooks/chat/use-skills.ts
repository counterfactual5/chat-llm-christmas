'use client';

/**
 * Skill list, picker attach/toggle, and create/preview/delete modal flows.
 */

import { useCallback, useState } from 'react';
import type { SkillItem } from '@/lib/chat/types';

export type SkillModalMode = 'create' | 'preview';

export function useChatSkills(opts: {
  setActiveSkillIds: (updater: string[] | ((prev: string[]) => string[])) => void;
  setIsSkillPickerOpen: (open: boolean) => void;
}) {
  const { setActiveSkillIds, setIsSkillPickerOpen } = opts;

  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [isSavingSkill, setIsSavingSkill] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [skillModalMode, setSkillModalMode] = useState<SkillModalMode>('create');
  const [previewSkillId, setPreviewSkillId] = useState<string | null>(null);
  const [skillDraftTitle, setSkillDraftTitle] = useState('');
  const [skillDraftDescription, setSkillDraftDescription] = useState('');
  const [skillDraftContent, setSkillDraftContent] = useState('');
  const [skillModalError, setSkillModalError] = useState('');
  const [skillPendingDelete, setSkillPendingDelete] = useState<SkillItem | null>(null);
  const [isDeletingSkill, setIsDeletingSkill] = useState(false);

  const toggleSkill = useCallback(
    (skillId: string) => {
      setActiveSkillIds((prev) =>
        prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId],
      );
    },
    [setActiveSkillIds],
  );

  const attachSkill = useCallback(
    (skill: SkillItem) => {
      setActiveSkillIds((prev) => (prev.includes(skill.id) ? prev : [...prev, skill.id]));
      setIsSkillPickerOpen(false);
    },
    [setActiveSkillIds, setIsSkillPickerOpen],
  );

  const openNewSkillModal = useCallback(() => {
    setSkillModalMode('create');
    setPreviewSkillId(null);
    setSkillDraftTitle('');
    setSkillDraftDescription('');
    setSkillDraftContent('');
    setSkillModalError('');
    setShowSkillModal(true);
  }, []);

  const openSkillPreview = useCallback((skill: SkillItem) => {
    setSkillModalMode('preview');
    setPreviewSkillId(skill.id);
    setSkillDraftTitle(skill.title);
    setSkillDraftDescription(String(skill.description || ''));
    setSkillDraftContent(skill.content);
    setSkillModalError('');
    setShowSkillModal(true);
  }, []);

  const createSkill = useCallback(
    async (title: string, content: string, description?: string) => {
      const trimmedTitle = title.trim();
      const trimmedContent = content.trim();
      const trimmedDescription = String(description || '').trim().slice(0, 240);
      if (!trimmedTitle || !trimmedContent) {
        setSkillModalError('请填写名称和内容');
        return false;
      }
      setIsSavingSkill(true);
      setSkillModalError('');
      try {
        const res = await fetch('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: trimmedTitle,
            content: trimmedContent,
            ...(trimmedDescription ? { description: trimmedDescription } : {}),
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || '保存失败');
        if (json.success || json.data) {
          const saved =
            json.data || {
              id: crypto.randomUUID(),
              title: trimmedTitle,
              content: trimmedContent,
              ...(trimmedDescription ? { description: trimmedDescription } : {}),
            };
          setSkills((prev) => [saved, ...prev.filter((s) => s.id !== saved.id)]);
          setShowSkillModal(false);
          return true;
        }
        throw new Error(json?.error || '保存失败');
      } catch (e: any) {
        console.error(e);
        setSkillModalError(e?.message || '保存失败');
        alert(e?.message || '保存失败');
        return false;
      } finally {
        setIsSavingSkill(false);
      }
    },
    [],
  );

  const requestDeleteSkill = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const skill = skills.find((s) => s.id === id) || null;
      if (!skill) return;
      setSkillPendingDelete(skill);
    },
    [skills],
  );

  const confirmDeleteSkill = useCallback(async () => {
    if (!skillPendingDelete || isDeletingSkill) return;
    setIsDeletingSkill(true);
    try {
      await fetch(`/api/skills/${skillPendingDelete.id}`, { method: 'DELETE' });
      setSkills((prev) => prev.filter((s) => s.id !== skillPendingDelete.id));
      setActiveSkillIds((prev) => prev.filter((id) => id !== skillPendingDelete.id));
      setSkillPendingDelete(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDeletingSkill(false);
    }
  }, [skillPendingDelete, isDeletingSkill, setActiveSkillIds]);

  return {
    skills,
    setSkills,
    isSavingSkill,
    showSkillModal,
    setShowSkillModal,
    skillModalMode,
    previewSkillId,
    skillDraftTitle,
    setSkillDraftTitle,
    skillDraftDescription,
    setSkillDraftDescription,
    skillDraftContent,
    setSkillDraftContent,
    skillModalError,
    setSkillModalError,
    skillPendingDelete,
    setSkillPendingDelete,
    isDeletingSkill,
    toggleSkill,
    attachSkill,
    openNewSkillModal,
    openSkillPreview,
    createSkill,
    requestDeleteSkill,
    confirmDeleteSkill,
  };
}
