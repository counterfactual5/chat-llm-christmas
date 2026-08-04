/**
 * Input/result shapes for session mutations.
 */

import type { ChatSession } from '@/lib/chat/types';

export type GeneratedFileInput = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  content?: string;
  createdAt?: number;
};

export type ToolViewInput = {
  id: string;
  viewType: string;
  title: string;
  sourceFileId?: string;
  sourceFileName?: string;
  createdAt?: number;
  data?: unknown;
};

import type { GmailApprovalDraft } from '@/lib/mcp/google/gmail-approval';

export type ToolRunInput = {
  name: string;
  status: 'start' | 'done' | 'awaiting_approval';
  query?: string;
  provider?: string;
  results?: Array<{ title: string; url: string; snippet: string; body?: string }>;
  error?: string;
  targetTimestamp?: number;
  approval?: GmailApprovalDraft;
  approvalOutcome?: 'sent' | 'cancelled';
};

export type ToolRunUpsertResult = {
  sessions: ChatSession[];
  /** Open the context panel when new reference sources appeared. */
  openContextPanel: boolean;
  /** Clear the UI-only webSourcesCleared latch when sources are restored. */
  unsetWebSourcesCleared: boolean;
};
