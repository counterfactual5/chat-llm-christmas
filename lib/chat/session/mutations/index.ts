/**
 * Session mutation public API (barrel).
 *
 *  types.ts      input/result shapes
 *  shared.ts     touchSession
 *  content.ts    content / reasoning / files / incomplete
 *  tool-runs.ts  tool run upsert + settle open runs
 *  review.ts     review report / findings / serialize
 *  settle.ts     orphan promote / empty fallback / seed cleanup
 */

export type {
  GeneratedFileInput,
  ToolViewInput,
  ToolRunInput,
  ToolRunUpsertResult,
} from '@/lib/chat/session/mutations/types';

export {
  withAppendedAssistantGeneratedFile,
  withAppendedAssistantToolView,
  withMarkedAssistantIncomplete,
  withAppendedAssistantContent,
  withAppendedAssistantReviewFix,
  withAppendedAssistantReasoning,
  withRewoundAssistantContentToReasoning,
} from '@/lib/chat/session/mutations/content';

export {
  withUpsertedAssistantToolRun,
  withSettledOpenToolRuns,
} from '@/lib/chat/session/mutations/tool-runs';

export {
  withUpsertedReviewReport,
  withUpsertedReviewFindings,
  serializeReviewToolRuns,
} from '@/lib/chat/session/mutations/review';

export {
  settleEmptyBodyAction,
  withPromotedOrphanReasoning,
  withEmptyReplyFallback,
  withSeededAssistantCleanup,
} from '@/lib/chat/session/mutations/settle';
