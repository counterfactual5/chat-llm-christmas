import type { ReviewCheckKind } from '@/lib/tools/review/claim-reviewer';

export type MessageActivityStep =
  | { id: string; kind: 'reasoning'; text: string }
  | { id: string; kind: 'tool'; toolRunId: string }
  | { id: string; kind: 'content'; text: string }
  | { id: string; kind: 'file'; fileId: string }
  /** Opens a new Process panel with a custom title (e.g. Plan / Search / Synthesize / Verify). */
  | { id: string; kind: 'stage'; title: string };

export type MessageToolRun = {
  id: string;
  name: string;
  status: 'start' | 'done';
  query?: string;
  provider?: string;
  results?: Array<{ title: string; url: string; snippet: string; body?: string }>;
  error?: string;
};

/** Deep Research job linkage on an assistant turn (Continue / cancel). */
export type MessageResearchState = {
  jobId: string;
  query: string;
  mode?: string;
  status?: string;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** data: URLs embedded in this turn (multimodal). */
  images?: Array<{
    url: string;
    name?: string;
    prompt?: string;
    model?: string;
    /** Gateway Files API id — prefer this over re-sending base64. */
    fileId?: string;
  }>;
  /** Files created via create_file for this assistant turn (Output panel). */
  files?: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    url: string;
    /** Inline UTF-8 text for local/gateway-backed downloads. */
    content?: string;
    createdAt: number;
  }>;
  /** Marks a synthetic compacted-history bubble. */
  compacted?: boolean;
  /** Model chain-of-thought / reasoning stream, shown in a collapsible panel. */
  reasoning?: string;
  /** Built-in tool runs (e.g. web_search) for this assistant turn. */
  toolRuns?: MessageToolRun[];
  /**
   * Chronological activity for this turn (thinking / tools / answer chunks /
   * generated files in arrival order). Rendered as interleaved Process
   * segments, file cards, and content.
   */
  activity?: MessageActivityStep[];
  /** True while streaming, or after a stop / refresh / truncated reply. */
  incomplete?: boolean;
  /** Raw finish_reason from upstream, kept so Resume can explain itself. */
  finishReason?: string | null;
  /** Human-readable explanation of why the reply looks cut off. */
  truncationReason?: string;
  /** Structured claim-vs-receipt findings from Claim Reviewer (legacy flat list). */
  reviewFindings?: Array<{
    id: string;
    severity: 'error' | 'warn';
    surface: string;
    verdict: string;
    claim: string;
    evidence: string;
  }>;
  /** Hierarchical Review panel (mid-turn / tool receipt / citation / recalc / vulnerability). */
  reviewReport?: {
    phase?: string;
    status: 'running' | 'done';
    checks: Array<{
      id: string;
      kind: ReviewCheckKind;
      status: 'running' | 'done' | 'skipped';
      summary: string;
      clean?: boolean;
      items?: Array<{
        severity: 'error' | 'warn';
        title: string;
        detail: string;
        ruleId?: string;
        verdict?: string;
        evidenceStrength?: 'strong' | 'moderate' | 'weak';
        surface?: string;
      }>;
      body?: string;
    }>;
  };
  /**
   * Short delta fix after Auto-review findings — rendered after the Review panel,
   * never folded into the main answer content.
   */
  reviewFix?: string;
  /** True while the post-review correction stream is in flight. */
  reviewFixStreaming?: boolean;
  /** Present when this assistant turn is driven by Deep Research (not /api/chat). */
  research?: MessageResearchState;
};

export type ExternalReferenceSourceKind =
  | 'web'
  | 'notion'
  | 'github'
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'google';

export type ReferenceSourceKind = 'upload' | ExternalReferenceSourceKind;

export type WebSearchSource = {
  title: string;
  url: string;
  snippet?: string;
  provider?: string;
  query?: string;
  sourceKind?: ReferenceSourceKind;
  /** UI-only anchor for uploads already present in a user message. */
  messageId?: string;
  kind?: 'image' | 'file';
};

export type ChatSession = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  /** Attached Skill ids for this chat — additive, not a System Prompt replacement. */
  skillIds?: string[];
  /** Per-chat MCP providers enabled for tool use (e.g. notion). */
  mcpIds?: string[];
  /** Per-chat claim reviewer auto switch (default on when absent). */
  autoReview?: boolean;
  /** Latest web search hits for this chat — shown in Reference Material. */
  webSources?: WebSearchSource[];
  /** User removed inherited sources; retain only sources added by later tool runs. */
  webSourcesCleared?: boolean;
  /** Last message id already processed by automatic memory extraction. */
  memoryExtractCursor?: string;
};

export type SkillItem = {
  id: string;
  title: string;
  content: string;
  /** Optional short library blurb; UI/catalog fall back to a content excerpt. */
  description?: string;
};

export type ModelOption = {
  id: string;
  owned_by: string;
  tier: 'free' | 'paid';
  group?: string;
  context_window?: number | null;
  max_output?: number | null;
  vision?: boolean;
};
