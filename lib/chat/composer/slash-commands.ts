/**
 * Product slash-command catalog shared by Composer + Sidebar command lists.
 * UI chrome stays local; this is the ordered command data only.
 */

import type { MessageKey } from '@/lib/i18n';

export type ProductSlashCommandId =
  | 'image'
  | 'research'
  | 'papers'
  | 'books'
  | 'skill'
  | 'review'
  | 'continue';

export type ProductSlashCommand = {
  id: ProductSlashCommandId;
  /** Text inserted into the composer (empty for continue / review actions). */
  insert: string;
  /** Shown as mono suffix when non-empty. */
  slash: string;
  /** i18n key for the row label. */
  labelKey: MessageKey;
  /** Requires a bound llm.christmas account. */
  requiresAccount: boolean;
  /**
   * How the host should run the command:
   * - insert: put `insert` into the composer
   * - continue: resume incomplete reply
   */
  action: 'insert' | 'continue';
};

export const PRODUCT_SLASH_COMMANDS: readonly ProductSlashCommand[] = [
  {
    id: 'image',
    insert: '/image ',
    slash: '/image',
    labelKey: 'generateImage',
    requiresAccount: true,
    action: 'insert',
  },
  {
    id: 'research',
    insert: '/research ',
    slash: '/research',
    labelKey: 'deepResearchCommand',
    requiresAccount: true,
    action: 'insert',
  },
  {
    id: 'papers',
    insert: '/papers ',
    slash: '/papers',
    labelKey: 'papersCommand',
    requiresAccount: true,
    action: 'insert',
  },
  {
    id: 'books',
    insert: '/books ',
    slash: '/books',
    labelKey: 'booksCommand',
    requiresAccount: true,
    action: 'insert',
  },
  {
    id: 'skill',
    insert: '/skill ',
    slash: '/skill',
    labelKey: 'createSkillCommand',
    requiresAccount: true,
    action: 'insert',
  },
  {
    id: 'review',
    insert: '/review ',
    slash: '/review',
    labelKey: 'requestReview',
    requiresAccount: true,
    action: 'insert',
  },
  {
    id: 'continue',
    insert: '',
    slash: '',
    labelKey: 'continueCommand',
    requiresAccount: false,
    action: 'continue',
  },
] as const;
