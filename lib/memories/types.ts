export const MEMORY_KINDS = [
  'preference',
  'instruction',
  'profile',
  'decision',
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type MemoryItem = {
  id: string;
  kind: MemoryKind | string;
  content: string;
  sourceSessionId?: string | null;
  sourceMessageId?: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number | null;
  useCount?: number;
};

export type MemoryCandidate = {
  kind: MemoryKind;
  content: string;
  confidence?: number;
  reason?: string;
};

export type MemoryExtractMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
};
