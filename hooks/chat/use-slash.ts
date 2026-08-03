'use client';

/**
 * Composer slash-menu: `/image`, `/research`, `/news`, `/wiki`, `/papers`, `/books`, `/review`, `/skill`.
 */

import { useEffect, useMemo, useState } from 'react';
import type { SkillItem } from '@/lib/chat/types';
import type { MessageKey, MessageVars } from '@/lib/i18n/messages';
import { SKILL_CREATOR_ID, skillSlashName } from '@/lib/skills/creator';
import type { SlashMenuItem } from '@/components/chat/composer/ChatComposer';

const MODE_TOKENS = new Set(['quick', 'standard', 'rigorous']);
const SOURCE_TOKENS = new Set(['web', 'literature', 'news', 'wiki', 'mixed']);

export function useChatSlash(opts: {
  input: string;
  setInput: (updater: string | ((prev: string) => string)) => void;
  skills: SkillItem[];
  isAccountBound: boolean;
  setActiveSkillIds: (updater: string[] | ((prev: string[]) => string[])) => void;
  setIsSkillPickerOpen: (open: boolean) => void;
  openLoginModal: () => void;
  attachSkill: (skill: SkillItem) => void;
  t: (key: MessageKey, vars?: MessageVars) => string;
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
    if (slashQuery == null || slashRaw == null) return [];

    const researchModeMatch = slashRaw.match(/^(?:research|研究)\s+(.*)$/i);
    if (researchModeMatch) {
      const tokens = researchModeMatch[1].trim().split(/\s+/).filter(Boolean);
      const [first, second] = tokens;
      const modeDone = MODE_TOKENS.has(first || '');
      const sourceDone = SOURCE_TOKENS.has(second || '');

      // Phase 1: pick depth (`/research <tab>` or partial mode).
      if (!modeDone) {
        const modeQuery = (first || '').toLowerCase();
      const modes: Array<{
          id: string;
          token: string;
          insert: string;
          titleKey: MessageKey;
          hintKey: MessageKey;
        }> = [
          {
            id: 'research-mode-quick',
            token: 'quick',
            insert: '/research quick ',
            titleKey: 'researchModeQuick' as MessageKey,
            hintKey: 'researchModeQuickHint' as MessageKey,
          },
          {
            id: 'research-mode-standard',
            token: 'standard',
            insert: '/research standard ',
            titleKey: 'researchModeStandard' as MessageKey,
            hintKey: 'researchModeStandardHint' as MessageKey,
          },
          {
            id: 'research-mode-rigorous',
            token: 'rigorous',
            insert: '/research rigorous ',
            titleKey: 'researchModeRigorous' as MessageKey,
            hintKey: 'researchModeRigorousHint' as MessageKey,
          },
        ];
        return modes
          .filter((m) => !modeQuery || m.token.startsWith(modeQuery))
          .map((m) => ({
            kind: 'command' as const,
            id: m.id,
            title: t(m.titleKey),
            insert: m.insert,
            hint: t(m.hintKey),
          }));
      }

      // Phase 2: after `/research standard `, pick source lane until query starts.
      if (!sourceDone) {
        if (tokens.length > 2) return [];
        if (tokens.length === 2 && !SOURCE_TOKENS.has(second || '')) return [];
        const sourceQuery = (second || '').toLowerCase();
        const lanes: Array<{
          id: string;
          token: string;
          titleKey: MessageKey;
          hintKey: MessageKey;
        }> = [
          {
            id: 'research-source-web',
            token: 'web',
            titleKey: 'researchSourceWeb' as MessageKey,
            hintKey: 'researchSourceWebHint' as MessageKey,
          },
          {
            id: 'research-source-literature',
            token: 'literature',
            titleKey: 'researchSourceLiterature' as MessageKey,
            hintKey: 'researchSourceLiteratureHint' as MessageKey,
          },
          {
            id: 'research-source-news',
            token: 'news',
            titleKey: 'researchSourceNews' as MessageKey,
            hintKey: 'researchSourceNewsHint' as MessageKey,
          },
          {
            id: 'research-source-wiki',
            token: 'wiki',
            titleKey: 'researchSourceWiki' as MessageKey,
            hintKey: 'researchSourceWikiHint' as MessageKey,
          },
          {
            id: 'research-source-mixed',
            token: 'mixed',
            titleKey: 'researchSourceMixed' as MessageKey,
            hintKey: 'researchSourceMixedHint' as MessageKey,
          },
        ];
        return lanes
          .filter((m) => !sourceQuery || m.token.startsWith(sourceQuery))
          .map((m) => ({
            kind: 'command' as const,
            id: m.id,
            title: t(m.titleKey),
            insert: `/research ${first} ${m.token} `,
            hint: t(m.hintKey),
          }));
      }

      // Mode + source chosen — user is typing the actual query.
      return [];
    }

    // Hide once a command is complete (`/image`) or args started (`/image …`).
    if (slashHasArgs) return [];
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
        hint: t('deepResearchCommandHint'),
      });
    }
    const newsPrefix =
      slashQuery === '' ||
      ('news'.startsWith(slashQuery) && slashQuery !== 'news') ||
      ('新闻'.startsWith(slashQuery) && slashQuery !== '新闻') ||
      ('资讯'.startsWith(slashQuery) && slashQuery !== '资讯');
    if (newsPrefix) {
      items.push({
        kind: 'command',
        id: 'news',
        title: t('newsCommand'),
        insert: '/news ',
        hint: t('newsCommandHint'),
      });
    }
    const wikiPrefix =
      slashQuery === '' ||
      ('wiki'.startsWith(slashQuery) && slashQuery !== 'wiki') ||
      ('wikipedia'.startsWith(slashQuery) && slashQuery !== 'wikipedia') ||
      ('百科'.startsWith(slashQuery) && slashQuery !== '百科') ||
      ('维基'.startsWith(slashQuery) && slashQuery !== '维基');
    if (wikiPrefix) {
      items.push({
        kind: 'command',
        id: 'wiki',
        title: t('wikiCommand'),
        insert: '/wiki ',
        hint: t('wikiCommandHint'),
      });
    }
    const papersPrefix =
      slashQuery === '' ||
      ('papers'.startsWith(slashQuery) && slashQuery !== 'papers') ||
      ('paper'.startsWith(slashQuery) && slashQuery !== 'paper') ||
      ('论文'.startsWith(slashQuery) && slashQuery !== '论文') ||
      ('学术'.startsWith(slashQuery) && slashQuery !== '学术');
    if (papersPrefix) {
      items.push({
        kind: 'command',
        id: 'papers',
        title: t('papersCommand'),
        insert: '/papers ',
        hint: t('papersCommandHint'),
      });
    }
    const booksPrefix =
      slashQuery === '' ||
      ('books'.startsWith(slashQuery) && slashQuery !== 'books') ||
      ('book'.startsWith(slashQuery) && slashQuery !== 'book') ||
      ('书籍'.startsWith(slashQuery) && slashQuery !== '书籍') ||
      ('图书'.startsWith(slashQuery) && slashQuery !== '图书');
    if (booksPrefix) {
      items.push({
        kind: 'command',
        id: 'books',
        title: t('booksCommand'),
        insert: '/books ',
        hint: t('booksCommandHint'),
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
    // `/review` takes optional focus args — same prefix pattern as `/image`.
    const reviewPrefix =
      slashQuery === '' ||
      ('review'.startsWith(slashQuery) && slashQuery !== 'review') ||
      ('审查'.startsWith(slashQuery) && slashQuery !== '审查');
    if (reviewPrefix) {
      items.push({
        kind: 'command',
        id: 'review',
        title: t('requestReview'),
        insert: '/review ',
        hint: t('requestReviewHint'),
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
    return items.slice(0, 10);
  }, [slashQuery, slashRaw, slashHasArgs, skills, isAccountBound, t]);

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
    queueMicrotask(() => setSlashHighlight(0));
  }, [slashRaw]);

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
