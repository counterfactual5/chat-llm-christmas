/**
 * Isomorphic context-token estimate for the Context panel and compact gate.
 * System bucket mirrors `buildChatSystemParts` (best-effort client opts).
 */

import { messagePlainText } from '@/lib/chat/message/display';
import { formatWebSourcesForReference } from '@/lib/chat/context/references';
import {
  buildChatSystemParts,
  joinChatSystemParts,
  type BuildChatSystemPartsOpts,
  type ChatSystemSkillInput,
} from '@/lib/chat/prompt/system-parts';
import { wantsProductUsageHelp } from '@/lib/chat/prompt/product-guide';
import type { Message, WebSearchSource } from '@/lib/chat/types';
import { estimateHistoryTokens } from '@/lib/chat/turn/history-estimate';
import { estimateTokensFromText } from '@/lib/models/specs';

export type ContextEstimateBreakdown = {
  system: number;
  /** Skill tokens already counted inside `system` — kept for UI detail only. */
  skills: number;
  reference: number;
  files: number;
  images: number;
  conversation: number;
  total: number;
  source: 'estimate';
};

export type EstimateContextBreakdownInput = {
  model: string;
  systemPrompt: string;
  threadId: string;
  searchEnabled: boolean;
  authorizedIntegrations: string[];
  googleRequestedButUnauthorized?: boolean;
  notionRequestedButUnauthorized?: boolean;
  githubRequestedButUnauthorized?: boolean;
  /** Best-effort; omit when client has no tools guidance string. */
  toolsGuidance?: string;
  skills: ChatSystemSkillInput[];
  memories?: Array<{ kind?: string; content?: string }>;
  memoriesEnabled?: boolean;
  requestReview?: boolean;
  autoReview?: boolean;
  webSources: WebSearchSource[];
  /** Pending composer text attachments (name + extracted text). */
  attachmentTexts: Array<{ name: string; text: string }>;
  messages: Message[];
  pendingImageCount: number;
  /**
   * When omitted, inferred from `messages` (assistant images / files).
   * Pass explicitly only when the caller already computed a matching flag.
   */
  hasGeneratedImages?: boolean;
  hasGeneratedFiles?: boolean;
  skillCreatorOn?: boolean;
  accountSkillCatalog?: string;
  /** Override expandProductGuide; default from latest user ask. */
  expandProductGuide?: boolean;
  userAsk?: string;
};

function latestUserAsk(messages: Message[], override?: string): string {
  if (override != null && String(override).trim()) return String(override).trim();
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      return messagePlainText(messages[i]).trim();
    }
  }
  return '';
}

function messagesHaveGeneratedImages(messages: Message[]): boolean {
  return (messages || []).some(
    (m) => m.role === 'assistant' && (m.images?.length || 0) > 0,
  );
}

function messagesHaveGeneratedFiles(messages: Message[]): boolean {
  return (messages || []).some(
    (m) => m.role === 'assistant' && (m.files?.length || 0) > 0,
  );
}

export function estimateContextBreakdown(
  input: EstimateContextBreakdownInput,
): ContextEstimateBreakdown {
  const userAsk = latestUserAsk(input.messages, input.userAsk);
  const expandProductGuide =
    input.expandProductGuide ?? wantsProductUsageHelp(userAsk);
  const referenceText = formatWebSourcesForReference(input.webSources || []);
  const hasGeneratedImages =
    input.hasGeneratedImages ?? messagesHaveGeneratedImages(input.messages);
  const hasGeneratedFiles =
    input.hasGeneratedFiles ?? messagesHaveGeneratedFiles(input.messages);

  const systemOpts: BuildChatSystemPartsOpts = {
    model: input.model,
    systemPrompt: input.systemPrompt,
    threadId: input.threadId,
    searchEnabled: Boolean(input.searchEnabled),
    authorizedIntegrations: input.authorizedIntegrations || [],
    googleRequestedButUnauthorized: Boolean(input.googleRequestedButUnauthorized),
    notionRequestedButUnauthorized: Boolean(input.notionRequestedButUnauthorized),
    githubRequestedButUnauthorized: Boolean(input.githubRequestedButUnauthorized),
    toolsGuidance: String(input.toolsGuidance || ''),
    skills: input.skills || [],
    memories: input.memories,
    memoriesEnabled: input.memoriesEnabled,
    requestReview: Boolean(input.requestReview),
    autoReview: Boolean(input.autoReview),
    referenceText,
    hasGeneratedImages,
    hasGeneratedFiles,
    skillCreatorOn: Boolean(input.skillCreatorOn),
    accountSkillCatalog: input.accountSkillCatalog,
    expandProductGuide,
    userAsk,
  };

  const systemText = joinChatSystemParts(buildChatSystemParts(systemOpts));
  const system = estimateTokensFromText(systemText);

  const skills = (input.skills || []).reduce((sum, s) => {
    const title = String(s?.title || '').trim();
    const content = String(s?.content || '').trim();
    if (!content) return sum;
    return sum + estimateTokensFromText(`Active Skill — ${title}:\n${content}`) + 8;
  }, 0);

  const reference = estimateTokensFromText(referenceText);
  const files = estimateTokensFromText(
    (input.attachmentTexts || [])
      .map((a) => `${a.name}\n${a.text}`)
      .join('\n\n'),
  );
  const historyImages = (input.messages || []).reduce(
    (sum, m) => sum + (m.images?.length || 0) * 1000,
    0,
  );
  const images = (input.pendingImageCount || 0) * 1000 + historyImages;
  const conversation = estimateHistoryTokens(input.messages || []);

  // Skills / referenceText are already inside `system` — do not add again.
  const total = system + files + images + conversation;

  return {
    system,
    skills,
    reference,
    files,
    images,
    conversation,
    total,
    source: 'estimate',
  };
}
