'use client';

/**
 * Composer slash-menu: `/image`, `/research`, `/skill`, `/review`, and skill name matching.
 */

import { useEffect, useMemo, useState } from 'react';
import type { SkillItem } from '@/lib/chat/types';
import { SKILL_CREATOR_ID, skillSlashName } from '@/lib/skills/creator';
import type { SlashMenuItem } from '@/components/chat/composer/ChatComposer';

export function useChatSlash(opts: {
  input: string;
  setInput: (updater: string | ((prev: string) => string)) => void;
  skills: SkillItem[];
  isAccountBound: boolean;
  setActiveSkillIds: (updater: string[] | ((prev: string[]) => string[])) => void;
  setIsSkillPickerOpen: (open: boolean) => void;
  openLoginModal: () => void;
  attachSkill: (skill: SkillItem) => void;
  requestClaimReview: () => void | Promise<void>;
  t: (key: any, vars?: any) => string;
}) {
  const {
    input,
    setInput,
    skills,
    isAccountBound,
    setActiveSkillIds,
    setIsSkillPickerOpen,
    openLoginModal,
    attachSkill,
    requestClaimReview,
    t,
  } = opts;

  const [slashHighlight, setSlashHighlight] = useState(0);

  /** Trailing `/query` at start of input or after a newline — slash-command mode. */
  const slashMatch = input.match(/(?:^|\n)\/([^\n]*)$/);
  const slashRaw = slashMatch ? slashMatch[1] : null;
  const slashQuery = slashRaw != null ? slashRaw.trim().toLowerCase() : null;
  /** True once the user typed a space after `/cmd` (arguments started). */
  const slashHasArgs = slashRaw != null && /\s/.test(slashRaw);

  const slashMenuItems = useMemo((): SlashMenuItem[] => {
    // Hide once a command is complete (`/image`) or args started (`/image …`).
    if (slashQuery == null || slashHasArgs) return [];
    const items: SlashMenuItem[] = [];
    const imagePrefix =
      slashQuery === '' ||
      ('image'.startsWith(slashQuery) && slashQuery !== 'image') ||
      ('img'.startsWith(slashQuery) && slashQuery !== 'img');
    if (imagePrefix) {
      items.push({
        kind: 'command',
        id: 'image',
        title: t('generateImage'),
        insert: '/image ',
        hint: t('imageHint'),
      });
    }
    const researchPrefix =
      slashQuery === '' ||
      ('research'.startsWith(slashQuery) && slashQuery !== 'research') ||
      ('研究'.startsWith(slashQuery) && slashQuery !== '研究');
    if (researchPrefix) {
      items.push({
        kind: 'command',
        id: 'research',
        title: t('deepResearchCommand'),
        insert: '/research ',
        hint: '/research',
      });
    }
    const skillPrefix =
      slashQuery === '' ||
      ('skill'.startsWith(slashQuery) && slashQuery !== 'skill') ||
      ('skill-create'.startsWith(slashQuery) && slashQuery !== 'skill-create');
    if (skillPrefix) {
      items.push({
        kind: 'command',
        id: 'skill-create',
        title: t('createSkillCommand'),
        insert: '/skill ',
        hint: '/skill',
      });
    }
    // Keep exact `/review` visible — this is an action, not a prompt with args.
    const reviewPrefix =
      slashQuery === '' ||
      'review'.startsWith(slashQuery) ||
      '审查'.startsWith(slashQuery);
    if (reviewPrefix) {
      items.push({
        kind: 'command',
        id: 'review',
        title: t('requestReview'),
        insert: '',
        hint: '/review',
      });
    }
    if (isAccountBound) {
      for (const s of skills) {
        const name = skillSlashName(s.title);
        if (
          slashQuery === '' ||
          (name.startsWith(slashQuery) && name !== slashQuery) ||
          (s.title.toLowerCase().includes(slashQuery) && name !== slashQuery)
        ) {
          items.push({ kind: 'skill', skill: s });
        }
      }
    }
    return items.slice(0, 8);
  }, [slashQuery, slashHasArgs, skills, isAccountBound, t]);

  const consumeSlashItem = (item: SlashMenuItem) => {
    if (item.kind === 'command') {
      if (item.id === 'skill-create') {
        if (!isAccountBound) {
          openLoginModal();
          return;
        }
        setActiveSkillIds((prev) =>
          prev.includes(SKILL_CREATOR_ID) ? prev : [...prev, SKILL_CREATOR_ID],
        );
      }
      if (item.id === 'review') {
        if (!isAccountBound) {
          openLoginModal();
          return;
        }
        setInput((prev) =>
          prev.replace(/(?:^|\n)\/[^\n]*$/, (seg) => (seg.startsWith('\n') ? '\n' : '')),
        );
        setIsSkillPickerOpen(false);
        setSlashHighlight(0);
        void requestClaimReview();
        return;
      }
      setInput((prev) =>
        prev.replace(/(?:^|\n)\/[^\n]*$/, (seg) =>
          seg.startsWith('\n') ? `\n${item.insert}` : item.insert,
        ),
      );
      setIsSkillPickerOpen(false);
      setSlashHighlight(0);
      return;
    }
    attachSkill(item.skill);
    setInput((prev) =>
      prev.replace(/(?:^|\n)\/[^\n]*$/, (seg) => (seg.startsWith('\n') ? '\n' : '')),
    );
    setSlashHighlight(0);
  };

  // Keep slash highlight in range when the filtered list shrinks.
  useEffect(() => {
    setSlashHighlight(0);
  }, [slashQuery]);

  return {
    slashMatch,
    slashRaw,
    slashQuery,
    slashHasArgs,
    slashMenuItems,
    slashHighlight,
    setSlashHighlight,
    consumeSlashItem,
  };
}
