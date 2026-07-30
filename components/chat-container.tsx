'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, Bot, User, Loader2, RefreshCw, Copy, Check, Trash2, 
  Menu, Plus, Settings2, Image as ImageIcon, 
  Mic, Square, Download, Key, Sparkles, ChevronDown, ChevronRight, LogOut, X,
  MoreHorizontal, Clock, FileText, PanelRightOpen, PanelRightClose, Quote,
  Play, ListOrdered, ScrollText, Search, Globe, Sun, Moon, Monitor, Blocks
} from 'lucide-react';
import { GitHubLogo } from '@/components/github-logo';
import { GoogleLogo } from '@/components/google-logo';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { CodeBlock } from './markdown/code-block';
import { BrandMark } from '@/components/brand-mark';
import { NotionLogo } from '@/components/notion-logo';
import { ingestFiles, type IngestedAttachment } from '@/lib/file-ingest';
import {
  buildPersistedUserMessageContent,
  hasPersistedImageTranscription,
  imageRefsFromMessageImages,
  injectionBodyFromToolResults,
  mergePersistedImageRefs,
  parseImageArchiveRefs,
  stripImageArchiveBlock,
  stripUserMessageArtifactsForDisplay,
} from '@/lib/image-understand';
import {
  AttachmentImageThumb,
  ImagePreviewOverlay,
  isImageAttachment,
} from '@/components/attachment-image-thumb';
import {
  DEFAULT_SYSTEM_PROMPT,
  estimateTokensFromText,
  formatContextWindow,
  getModelSpec,
} from '@/lib/model-specs';
import { contentHasThinkMarkup, createThinkStreamParser, extractThinkBlocks } from '@/lib/think-tags';
import {
  contentHasToolMarkup,
  createToolCallStripper,
  stripFakeToolMarkup,
} from '@/lib/tool-tags';
import { stripMessageStamp } from '@/lib/time-context';
import {
  compactQuoteMath,
  hasUnclosedDisplayMath,
  looksLikeTruncatedMath,
  markdownFromDomSelection,
  prepareChatMarkdown,
} from '@/lib/markdown-math';
import { useLocale } from '@/lib/i18n';
import {
  isGoogleMcpId,
  normalizeGoogleIntegrations,
} from '@/lib/integrations/google-services';
import {
  NATURAL_FINISH_REASONS,
  SOFT_TRUNCATION_REASONS,
  truncationFromFinishReason,
} from '@/lib/truncation';

const KATEX_OPTIONS = {
  throwOnError: false,
  // Soft muted errors — never KaTeX's default piercing red.
  errorColor: 'var(--chat-math-error, #a8a29e)',
} as const;

type TruncationHints = {
  /** Server sent truncated=true/false on the completion event. */
  serverTruncated?: boolean | null;
  serverReason?: string;
};

/**
 * Decide whether a reply was cut off.
 * Prefer: stored hard reason → server truncated flag → finish_reason →
 * structural (code/math/think) → incomplete flag.
 * Do NOT guess from “工具/工作区” body text — that false-triggers Continue.
 */
function analyzeTruncation(
  content: string,
  finishReason?: string | null,
  incomplete?: boolean,
  storedReason?: string,
  hints?: TruncationHints,
): { truncated: boolean; reason: string } {
  const text = (content || '').trimEnd();
  if (!text) return { truncated: false, reason: '' };

  // Sticky only for hard reasons. Soft legacy reasons are revalidated below.
  if (storedReason && !SOFT_TRUNCATION_REASONS.has(storedReason)) {
    return { truncated: true, reason: storedReason };
  }

  // Authoritative server completion event.
  if (hints?.serverTruncated === true) {
    return {
      truncated: true,
      reason: hints.serverReason || truncationFromFinishReason(finishReason).reason || 'Reply was interrupted',
    };
  }
  if (hints?.serverTruncated === false) {
    // Still honor strong structural cuts (model said stop but left an open fence).
    const structural = structuralTruncation(text, finishReason);
    if (structural.truncated) return structural;
    return { truncated: false, reason: '' };
  }

  const fromFinish = truncationFromFinishReason(finishReason);
  if (fromFinish.truncated) {
    // After a successful tool round, a clean answer with stop/end_turn is handled
    // above. tool_calls on the final stream still means unfinished.
    return fromFinish;
  }

  const structural = structuralTruncation(text, finishReason);
  if (structural.truncated) return structural;

  // User hit Stop / page refreshed mid-stream / connection dropped.
  // Do not honor incomplete when it was only paired with a soft legacy reason
  // (e.g. false “Stopped while trying to use tools” on a finished answer).
  if (incomplete) {
    if (storedReason && SOFT_TRUNCATION_REASONS.has(storedReason)) {
      return { truncated: false, reason: '' };
    }
    if (finishReason && NATURAL_FINISH_REASONS.has(finishReason)) {
      return { truncated: false, reason: '' };
    }
    return { truncated: true, reason: 'Reply was interrupted' };
  }

  return { truncated: false, reason: '' };
}

function structuralTruncation(
  text: string,
  finishReason?: string | null,
): { truncated: boolean; reason: string } {
  if ((text.match(/```/g) || []).length % 2 === 1) {
    return { truncated: true, reason: 'Unclosed code block' };
  }
  // Odd $$ is often a false positive when the model *talks about* LaTeX
  // (“同一个 $$ 块”). Only Continue when the tail still looks like cut-off math,
  // or the provider did not report a clean natural stop.
  if (hasUnclosedDisplayMath(text)) {
    const naturalStop = !finishReason || NATURAL_FINISH_REASONS.has(finishReason);
    const endsLikeSentence = /[.!?。！？…]\s*$/.test(text);
    if (looksLikeTruncatedMath(text) || !naturalStop || !endsLikeSentence) {
      return { truncated: true, reason: 'Unclosed math block' };
    }
  }
  {
    const { content: visible, reasoning } = extractThinkBlocks(text);
    if (
      contentHasThinkMarkup(text) &&
      /<think\b|<thinking\b/i.test(text) &&
      !/<\/(?:think|thinking)>/i.test(text)
    ) {
      return { truncated: true, reason: 'Unclosed thinking block' };
    }
    // Long thinking then only a short bridge sentence — usually cut before the real answer.
    if (reasoning.length > 80 && visible.trim().length > 0 && visible.trim().length < 180) {
      return { truncated: true, reason: 'Stopped before finishing the answer' };
    }
  }
  return { truncated: false, reason: '' };
}

/** Heuristic: partial reply is stuck narrating IDE/agent tool use (Continue prompt only). */
function looksLikeToolNarration(text: string): boolean {
  // Negated limits (“不能扫描工作区”) are capability disclaimers, not agent narration.
  if (
    /不能[^。\n]{0,40}(?:工作区|workspace|shell)|无法[^。\n]{0,40}(?:工作区|workspace)|do not (?:read|scan)|cannot read local/i.test(
      text,
    )
  ) {
    return false;
  }
  // Require IDE/workspace agent narration — bare "tool_call" matches Agent docs
  // and Notion workflow templates, which wrongly wiped Continue mid-reply.
  return /正在扫描(?:工作区|项目|仓库)|改用\s*shell|同步\s*I\/O|扫描工作区|定位同步|Shell\s+扫描|异步重构|排查工作区|<(?:tool_call|tool_calls|function_call)\b/i.test(
    text,
  );
}

/** Assistant is continuing a coding/agent task that doesn't match this chat's last user ask. */
function assistantMismatchesUserTopic(userText: string, assistantText: string): boolean {
  if (!looksLikeToolNarration(assistantText)) return false;
  // Same-chat coding asks may legitimately mention workspace — don't treat as cross-bleed.
  if (
    /async|python|refactor|代码|工作区|workspace|shell|文件|bug|报错|debug|重构|notion|模板|template|agent/i.test(
      userText,
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Continuation instructions tailored to whatever structure the reply was cut
 * inside, so the model resumes the same table / code block / formula instead of
 * restarting it with a fresh header.
 */
function buildContinuationPrompt(previous: string): string {
  const text = previous.trimEnd();
  const tail = text.slice(-400);
  const lines = text.split('\n');
  const lastLine = lines[lines.length - 1] ?? '';

  const rules: string[] = [
    'Continue your previous reply from exactly where it stopped.',
    'Your output is appended directly to the previous text, so do not repeat any sentence, row, or heading you already wrote, do not restart the answer, and do not add an intro or apology.',
  ];

  const insideCodeBlock = (text.match(/```/g) || []).length % 2 === 1;
  const insideMath = (text.match(/\$\$/g) || []).length % 2 === 1;
  const insideTable = /^\s*\|/.test(lastLine);
  const toolStuck = looksLikeToolNarration(text);

  if (toolStuck) {
    rules.push(
      'You previously tried to use workspace/shell/search tools that are NOT available in this web chat.',
      'Do not continue scanning files, running shell, or emitting tool_call markup.',
      'Stop the tool narration and answer the user\'s original request directly with what you know.',
    );
  }

  if (insideCodeBlock) {
    rules.push(
      'You stopped inside a fenced code block. Continue the code directly with no new opening fence, and close it with ``` when the code is finished.',
    );
  }
  if (insideMath) {
    rules.push(
      'You stopped inside a $$ math block. Continue the LaTeX from that exact point and close the block with $$. Never open a new $$ block for this formula.',
    );
  }
  if (insideTable) {
    rules.push(
      'You stopped inside a Markdown table. Emit only the remaining data rows, starting immediately with a newline followed by |. Do not repeat the header row, do not emit another |---| separator row, and do not repeat the last row shown below.',
    );
  }
  if (!insideCodeBlock && !insideMath && !insideTable && !toolStuck) {
    rules.push(
      'If the text was cut mid-sentence or mid-word, resume from that exact character.',
    );
  }

  return `${rules.join('\n')}\n\nHere are the last characters you wrote — continue immediately after them:\n\n<<<TAIL\n${tail}\nTAIL>>>`;
}

// --- Types ---
interface Message {
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
  /** Marks a synthetic compacted-history bubble. */
  compacted?: boolean;
  /** Model chain-of-thought / reasoning stream, shown in a collapsible panel. */
  reasoning?: string;
  /** Built-in tool runs (e.g. web_search) for this assistant turn. */
  toolRuns?: Array<{
    id: string;
    name: string;
    status: 'start' | 'done';
    query?: string;
    provider?: string;
    results?: Array<{ title: string; url: string; snippet: string }>;
    error?: string;
  }>;
  /**
   * Chronological activity for this turn (thinking / tools / answer chunks in
   * arrival order). Rendered as interleaved Process segments + content.
   */
  activity?: Array<
    | { id: string; kind: 'reasoning'; text: string }
    | { id: string; kind: 'tool'; toolRunId: string }
    | { id: string; kind: 'content'; text: string }
  >;
  /** True while streaming, or after a stop / refresh / truncated reply. */
  incomplete?: boolean;
  /** Raw finish_reason from upstream, kept so Resume can explain itself. */
  finishReason?: string | null;
  /** Human-readable explanation of why the reply looks cut off. */
  truncationReason?: string;
}

type ExternalReferenceSourceKind =
  | 'web'
  | 'notion'
  | 'github'
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'google';

type ReferenceSourceKind = 'upload' | ExternalReferenceSourceKind;

type WebSearchSource = {
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

function referenceSourceKind(provider: string | undefined, toolName: string | undefined): ExternalReferenceSourceKind {
  const name = String(toolName || '').toLowerCase();
  if (name.startsWith('gmail_') || name.startsWith('gmail-')) return 'gmail';
  if (name.startsWith('calendar_') || name.startsWith('calendar-')) return 'calendar';
  if (name.startsWith('drive_') || name.startsWith('drive-')) return 'drive';
  if (provider === 'notion') return 'notion';
  if (provider === 'github') return 'github';
  if (provider === 'google') return 'google';
  return 'web';
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  /** Attached Skill ids for this chat — additive, not a System Prompt replacement. */
  skillIds?: string[];
  /** Per-chat MCP providers enabled for tool use (e.g. notion). */
  mcpIds?: string[];
  /** Latest web search hits for this chat — shown in Reference Material. */
  webSources?: WebSearchSource[];
  /** User removed inherited sources; retain only sources added by later tool runs. */
  webSourcesCleared?: boolean;
}

function formatWebSourcesForReference(sources: WebSearchSource[]): string {
  if (!sources.length) return '';
  const byQuery = new Map<string, WebSearchSource[]>();
  for (const s of sources) {
    const key = s.query?.trim() || 'web';
    const list = byQuery.get(key) || [];
    list.push(s);
    byQuery.set(key, list);
  }
  const blocks: string[] = [];
  let n = 1;
  for (const [query, list] of byQuery) {
    const provider = list[0]?.provider;
    const header =
      provider === 'upload'
        ? 'Uploaded files and images in this chat:'
        : provider === 'notion'
        ? query && query !== 'web'
          ? `Notion results for "${query}":`
          : 'Notion pages:'
        : provider === 'google'
          ? query && query !== 'web'
            ? `Google results for "${query}":`
            : 'Google results:'
          : provider === 'github'
            ? query && query !== 'web'
              ? `GitHub results for "${query}":`
              : 'GitHub results:'
        : query === 'web'
          ? 'Web search results:'
          : `Web search results for "${query}"${provider && provider !== 'none' ? ` (${provider})` : ''}:`;
    blocks.push(
      [
        header,
        ...list.map((s) => {
          const title = s.title || s.url || 'Upload';
          const snip = s.snippet?.trim() ? `\n   ${s.snippet.trim()}` : '';
          // Uploaded images are already sent as multimodal parts (or processed by
          // Image Understand). Never duplicate data:/blob:/file URLs as prompt text.
          if (s.provider === 'upload') return `${n++}. ${title}${snip}`;
          return `${n++}. [${title}](${s.url})${snip}`;
        }),
      ].join('\n'),
    );
  }
  return blocks.join('\n\n');
}

/** Rebuild Material sources from every completed search in the chat (deduped by URL). */
function collectWebSourcesFromMessages(messages: Message[]): WebSearchSource[] {
  const seen = new Set<string>();
  const out: WebSearchSource[] = [];
  for (const m of messages) {
    for (const run of m.toolRuns || []) {
      if (run.status !== 'done' || !run.results?.length) continue;
      // Image understand injects plain text into the prompt — never a Material source.
      if (
        run.name === 'image_understand' ||
        run.provider === 'zhipu-vision'
      ) {
        continue;
      }
      for (const r of run.results) {
        if (!r.url || seen.has(r.url)) continue;
        // Skip data: / relative / empty — those are not browseable sources.
        if (/^(data:|blob:|\/)/i.test(r.url)) continue;
        seen.add(r.url);
        out.push({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          provider: run.provider,
          query: run.query,
          sourceKind: referenceSourceKind(run.provider, run.name),
        });
      }
    }
  }
  return out.slice(-40);
}

/** User-uploaded images and ingested text files (not model-generated pictures). */
function collectUserUploadsFromMessages(messages: Message[]): WebSearchSource[] {
  const seen = new Set<string>();
  const out: WebSearchSource[] = [];

  for (const m of messages) {
    if (m.role !== 'user') continue;

    for (const img of m.images || []) {
      const url = img.fileId
        ? `/api/files/${encodeURIComponent(img.fileId)}`
        : String(img.url || '').trim();
      const key = img.fileId || url;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        title: img.name || 'Image',
        url,
        snippet: '',
        provider: 'upload',
        query: 'upload',
        messageId: m.id,
        kind: 'image',
      });
    }

    const content = String(m.content || '');
    const fileRe = /\[Attached File: ([^\]]+)\]\n([\s\S]*?)(?=\n\n---\n\n|\n\n\[Attached File:|$)/g;
    let match: RegExpExecArray | null;
    while ((match = fileRe.exec(content)) !== null) {
      const name = match[1].trim();
      const text = match[2].trim();
      const key = `file:${m.id}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title: name,
        url: '',
        snippet: text.slice(0, 400),
        provider: 'upload',
        query: 'upload',
        messageId: m.id,
        kind: 'file',
      });
    }
  }

  return out;
}



type SkillItem = { id: string; title: string; content: string };

function skillSlashName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '');
  return slug.slice(0, 48) || 'skill';
}

/** Explicit image-gen command: `/image a cat` or `/img a cat`. */
const IMAGE_CMD_RE = /^(?:\/image|\/img)\s+([\s\S]+)$/i;

function parseImageCommand(text: string): string | null {
  const m = text.trim().match(IMAGE_CMD_RE);
  return m?.[1]?.trim() || null;
}

interface ModelOption {
  id: string;
  owned_by: string;
  tier: 'free' | 'paid';
  group?: string;
  context_window?: number | null;
  max_output?: number | null;
  vision?: boolean;
}

function messagePlainText(message: Message): string {
  // Count visible turn text (answer + thinking) so Context used tracks rollback.
  return [message.content, message.reasoning].filter(Boolean).join('\n');
}

/** Strip leaked <think> / fake tool tags for display / export; merge into reasoning panel. */
function displayAssistantParts(message: Message): { content: string; reasoning: string } {
  const hasThink = contentHasThinkMarkup(message.content);
  const extracted = hasThink
    ? extractThinkBlocks(message.content)
    : { content: message.content, reasoning: '' };
  return {
    content: stripMessageStamp(stripFakeToolMarkup(extracted.content)),
    reasoning: [message.reasoning, extracted.reasoning].filter(Boolean).join('\n\n'),
  };
}

function sessionHasImages(messages: Message[], pending: IngestedAttachment[]): boolean {
  if (pending.some((a) => Boolean(a.dataUrl || a.type.startsWith('image/')))) return true;
  return messages.some((m) => (m.images?.length || 0) > 0);
}

function toApiMessages(
  messages: Message[],
  opts?: { vision?: boolean },
) {
  const vision = Boolean(opts?.vision);
  let lastUserIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') lastUserIdx = i;
  }

  return messages.map((m, i) => {
    let content = m.content;
    let images =
      m.images?.map((img) => ({
        url: img.url,
        fileId: img.fileId,
        prompt: img.prompt,
        name: img.name,
      })) || [];

    if (m.role === 'user') {
      const transcribed = hasPersistedImageTranscription(content || '');
      if (vision) {
        const archived = mergePersistedImageRefs(
          imageRefsFromMessageImages(m.images),
          parseImageArchiveRefs(content || ''),
        );
        if (archived.length > 0) {
          images = archived.map((r) => ({
            fileId: r.fileId,
            url: r.fileId
              ? `/api/files/${encodeURIComponent(r.fileId)}`
              : r.url || '',
            name: r.label,
            prompt: undefined,
          }));
        }
        if (transcribed) {
          // Prefer pixels; drop injection + archive metadata from the prompt.
          content = stripUserMessageArtifactsForDisplay(content || '');
          if (!content.trim() && images.length > 0) content = '(image)';
        }
      } else if (transcribed) {
        // Text path: keep transcription, omit pixels + archive block (archive is
        // only for local recovery / later vision switches).
        images = [];
        content = stripImageArchiveBlock(content || '');
      } else if (i !== lastUserIdx) {
        // Older untranscribed uploads: keep lightweight refs only (no data:
        // pixels). The server renders them as 【历史图片引用（未转写）】 markers so
        // the model can transcribe a specific one on demand.
        images = images
          .filter((img) => img.fileId || !String(img.url || '').startsWith('data:'))
          .map((img) => ({
            ...img,
            url: img.fileId
              ? `/api/files/${encodeURIComponent(img.fileId)}`
              : img.url,
          }));
      }
    }

    return {
      role: m.role,
      content,
      images,
      timestamp: m.timestamp as number | undefined,
    };
  });
}

function messageImagesToIngested(images: Message['images']): IngestedAttachment[] {
  return (images || []).map((img) => {
    const url = img.url;
    const isData = url.startsWith('data:');
    const apiPreview = img.fileId
      ? `/api/files/${encodeURIComponent(img.fileId)}`
      : url;
    return {
      id: crypto.randomUUID(),
      name: img.name || 'image.png',
      type: 'image/png',
      size: 0,
      dataUrl: isData ? url : undefined,
      previewUrl: isData ? url : apiPreview,
      fileId: img.fileId,
    };
  });
}

function ingestedToMessageImages(items: IngestedAttachment[]): NonNullable<Message['images']> {
  return items
    .filter((a) => a.dataUrl || a.fileId || a.previewUrl)
    .map((a) => ({
      url: a.fileId
        ? `/api/files/${encodeURIComponent(a.fileId)}`
        : a.dataUrl || a.previewUrl!,
      name: a.name,
      fileId: a.fileId,
    }));
}

type QueuedTask = {
  id: string;
  sessionId: string;
  content: string;
  baseMessages?: Message[];
  enqueueTime: number;
};

export default function ChatContainer() {
  const { t, locale, setLocale } = useLocale();
  const { theme, preference, toggleTheme } = useTheme();

  // State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  /** Per-session streaming flags — multiple chats can run in parallel. */
  const [loadingBySession, setLoadingBySession] = useState<Record<string, boolean>>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState('');
  const [editingMessageAttachments, setEditingMessageAttachments] = useState<IngestedAttachment[]>(
    [],
  );
  
  // Model & Auth State
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem('llm_christmas_selected_model') || '';
    } catch {
      return '';
    }
  });
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [isAccountBound, setIsAccountBound] = useState(false);
  const [tempKeyInput, setTempKeyInput] = useState<string>('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  /** `notion` | `github` = MCP connect sheet; `login` = first-time sign-in only. */
  const [authModalMode, setAuthModalMode] = useState<'login' | 'notion' | 'github' | 'google'>('login');
  const [showApiKeyLogin, setShowApiKeyLogin] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountUsername, setAccountUsername] = useState<string | null>(null);
  const [notionStatus, setNotionStatus] = useState<{
    connected: boolean;
    available: boolean;
    label?: string;
  } | null>(null);
  const [notionBusy, setNotionBusy] = useState(false);
  const [githubStatus, setGitHubStatus] = useState<{
    connected: boolean;
    available: boolean;
    label?: string;
  } | null>(null);
  const [githubBusy, setGitHubBusy] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<{
    connected: boolean;
    available: boolean;
    label?: string;
  } | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  /** Gate localStorage writes until boot has restored (or decided there is nothing). */
  const [chatsHydrated, setChatsHydrated] = useState(false);

  // Settings State
  const [sessionMenuOpenId, setSessionMenuOpenId] = useState<string | null>(null);
  const [sessionPendingDelete, setSessionPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [confirmClearSourcesOpen, setConfirmClearSourcesOpen] = useState(false);
  /** Past-day sidebar groups start collapsed; toggles remembered for this page load. */
  const [pastDayOpen, setPastDayOpen] = useState<Record<string, boolean>>({});
  /**
   * After Thought / answer text goes idle but the turn is still open, show a
   * textless spinner under the bubble (not a fake "Thinking…" label).
   */
  const [replyWaitByMessage, setReplyWaitByMessage] = useState<Record<string, boolean>>({});

  // Skills State
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [isSavingSkill, setIsSavingSkill] = useState(false);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const [mcpExpanded, setMcpExpanded] = useState(false);
  const [googleMcpMenuOpen, setGoogleMcpMenuOpen] = useState(false);
  const [plusFlyout, setPlusFlyout] = useState<null | 'skills' | 'mcp'>(null);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [skillDraftTitle, setSkillDraftTitle] = useState('');
  const [skillDraftContent, setSkillDraftContent] = useState('');
  const [skillDraftBrief, setSkillDraftBrief] = useState('');
  const [isGeneratingSkill, setIsGeneratingSkill] = useState(false);
  const [skillModalError, setSkillModalError] = useState('');
  const [skillPendingDelete, setSkillPendingDelete] = useState<SkillItem | null>(null);
  const [isDeletingSkill, setIsDeletingSkill] = useState(false);
  const [isSkillPickerOpen, setIsSkillPickerOpen] = useState(false);
  const [slashHighlight, setSlashHighlight] = useState(0);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const plusMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);
  const [picturesExpanded, setPicturesExpanded] = useState(false);
  const [referenceExpanded, setReferenceExpanded] = useState(false);
  /** Per-source groups within Reference Material; all start collapsed. */
  const [referenceGroupsOpen, setReferenceGroupsOpen] = useState<Record<string, boolean>>({});
  const [systemPromptExpanded, setSystemPromptExpanded] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  /** When the user explicitly clears web sources, suppress auto-restore from history. */
  const [webSourcesCleared, setWebSourcesCleared] = useState(false);
  const [attachments, setAttachments] = useState<IngestedAttachment[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [imagePreviewSrc, setImagePreviewSrc] = useState<string | null>(null);
  const [compactNotice, setCompactNotice] = useState('');
  const [isCompacting, setIsCompacting] = useState(false);

  // Settings State
  const [isListening, setIsListening] = useState(false);
  const [messageQueue, setMessageQueue] = useState<QueuedTask[]>([]);
  // Stop freezes that session's queue; Continue / Send Now resumes it.
  const [queuePausedBySession, setQueuePausedBySession] = useState<Record<string, boolean>>({});
  const [queueExpanded, setQueueExpanded] = useState(true);
  /** Explicit open/closed overrides for reasoning panels (message id → open). */
  const [reasoningOpen, setReasoningOpen] = useState<Record<string, boolean>>({});
  const [toolRunOpen, setToolRunOpen] = useState<Record<string, boolean>>({});
  /** Text snippets quoted from message selection into the composer (multi-select). */
  const [quotedSelections, setQuotedSelections] = useState<string[]>([]);
  const quoteToolbarWrapRef = useRef<HTMLDivElement>(null);
  const quoteToolbarTextRef = useRef('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerImeComposingRef = useRef(false);
  /** Suppress Enter-to-send right after IME commits (same key often confirms composition). */
  const composerImeEnterLockRef = useRef(false);
  const editImeComposingRef = useRef(false);
  const editImeEnterLockRef = useRef(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const sessionsRef = useRef(sessions);
  const activeSessionIdRef = useRef(activeSessionId);
  const skillsRef = useRef(skills);
  const notionStatusRef = useRef(notionStatus);
  const githubStatusRef = useRef(githubStatus);
  const googleStatusRef = useRef(googleStatus);
  const dragDepthRef = useRef(0);
  // Only auto-follow new tokens while the user is already near the bottom.
  const stickToBottomRef = useRef(true);

  sessionsRef.current = sessions;
  activeSessionIdRef.current = activeSessionId;
  skillsRef.current = skills;
  notionStatusRef.current = notionStatus;
  githubStatusRef.current = githubStatus;
  googleStatusRef.current = googleStatus;

  const isSessionLoading = (sessionId: string) => Boolean(loadingBySession[sessionId]);
  const isActiveLoading = isSessionLoading(activeSessionId);
  const activeQueue = useMemo(
    () => messageQueue.filter((task) => task.sessionId === activeSessionId),
    [messageQueue, activeSessionId],
  );
  const queuePaused = Boolean(queuePausedBySession[activeSessionId]);

  const scrubNotionMcpFromSessions = () => {
    setSessions((prev) =>
      prev.map((s) => {
        const next = (s.mcpIds || []).filter((id) => id !== 'notion');
        if (next.length === (s.mcpIds || []).length) return s;
        return { ...s, mcpIds: next, updatedAt: Date.now() };
      }),
    );
    setActiveMcpIds((prev) => prev.filter((id) => id !== 'notion'));
  };

  const scrubGitHubMcpFromSessions = () => {
    setSessions((prev) =>
      prev.map((s) => {
        const next = (s.mcpIds || []).filter((id) => id !== 'github');
        if (next.length === (s.mcpIds || []).length) return s;
        return { ...s, mcpIds: next, updatedAt: Date.now() };
      }),
    );
    setActiveMcpIds((prev) => prev.filter((id) => id !== 'github'));
  };

  const scrubGoogleMcpFromSessions = () => {
    setSessions((prev) =>
      prev.map((s) => {
        const next = (s.mcpIds || []).filter((id) => !isGoogleMcpId(id));
        if (next.length === (s.mcpIds || []).length) return s;
        return { ...s, mcpIds: next, updatedAt: Date.now() };
      }),
    );
    setActiveMcpIds((prev) => prev.filter((id) => !isGoogleMcpId(id)));
  };

  const refreshAccountStatus = async () => {
    try {
      const response = await fetch('/api/account', { cache: 'no-store' });
      const data = await response.json();
      const bound = Boolean(data?.bound);
      setIsAccountBound(bound);
      setAccountUsername(bound ? (data?.username ? String(data.username) : null) : null);
      return bound;
    } catch {
      setIsAccountBound(false);
      setAccountUsername(null);
      return false;
    }
  };

  const fetchIntegrations = async () => {
    try {
      const response = await fetch('/api/integrations', { cache: 'no-store' });
      if (!response.ok) {
        setNotionStatus(null);
        setGitHubStatus(null);
        setGoogleStatus(null);
        scrubNotionMcpFromSessions();
        scrubGitHubMcpFromSessions();
        scrubGoogleMcpFromSessions();
        return;
      }
      const data = await response.json();
      const list = (data?.integrations || []) as Array<{
        provider?: string;
        connected?: boolean;
        available?: boolean;
        label?: string;
      }>;
      const notion = list.find((i) => i?.provider === 'notion');
      const github = list.find((i) => i?.provider === 'github');
      const google = list.find((i) => i?.provider === 'google');

      if (!notion) {
        setNotionStatus(null);
        scrubNotionMcpFromSessions();
      } else {
        const connected = Boolean(notion.connected);
        setNotionStatus({
          connected,
          available: Boolean(notion.available),
          label: notion.label || undefined,
        });
        if (!connected) scrubNotionMcpFromSessions();
      }

      if (!github) {
        setGitHubStatus(null);
        scrubGitHubMcpFromSessions();
      } else {
        const connected = Boolean(github.connected);
        setGitHubStatus({
          connected,
          available: Boolean(github.available),
          label: github.label || undefined,
        });
        if (!connected) scrubGitHubMcpFromSessions();
      }

      if (!google) {
        setGoogleStatus(null);
        scrubGoogleMcpFromSessions();
      } else {
        const connected = Boolean(google.connected);
        setGoogleStatus({
          connected,
          available: Boolean(google.available),
          label: google.label || undefined,
        });
        if (!connected) scrubGoogleMcpFromSessions();
      }
    } catch {
      setNotionStatus(null);
      setGitHubStatus(null);
      setGoogleStatus(null);
      scrubNotionMcpFromSessions();
      scrubGitHubMcpFromSessions();
      scrubGoogleMcpFromSessions();
    }
  };

  const disconnectNotion = async () => {
    setNotionBusy(true);
    try {
      await fetch('/api/integrations/notion', { method: 'DELETE' });
      await fetchIntegrations();
    } finally {
      setNotionBusy(false);
    }
  };

  const disconnectGitHub = async () => {
    setGitHubBusy(true);
    try {
      await fetch('/api/integrations/github', { method: 'DELETE' });
      await fetchIntegrations();
    } finally {
      setGitHubBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    setGoogleBusy(true);
    try {
      await fetch('/api/integrations/google', { method: 'DELETE' });
      await fetchIntegrations();
    } finally {
      setGoogleBusy(false);
    }
  };

  useEffect(() => {
    if (!showAuthModal || !isAccountBound) return;
    if (authModalMode !== 'notion' && authModalMode !== 'github' && authModalMode !== 'google') return;
    void fetchIntegrations();
  }, [showAuthModal, authModalMode, isAccountBound]);

  // Load Saved State
  useEffect(() => {
    // Migrate away from the old insecure client-side key storage.
    localStorage.removeItem('llm_christmas_user_key');

    try {
      const params = new URLSearchParams(window.location.search);
      const authError = params.get('auth_error');
      const notionOk = params.get('notion_connected');
      const notionAuthReturn = params.get('notion_auth');
      const githubOk = params.get('github_connected');
      const githubAuthReturn = params.get('github_auth');
      const googleOk = params.get('google_connected');
      const googleAuthReturn = params.get('google_auth');
      const mainConnected = params.get('connected');

      if (
        authError ||
        notionOk ||
        githubOk ||
        googleOk ||
        mainConnected ||
        notionAuthReturn ||
        githubAuthReturn ||
        googleAuthReturn
      ) {
        const clean = new URL(window.location.href);
        clean.search = '';
        window.history.replaceState({}, '', clean.pathname);
      }

      void refreshAccountStatus()
        .then(async (bound) => {
          // Restore chats BEFORE waiting on models — and before any persist effect
          // runs with an empty sessions array (that used to wipe localStorage).
          if (bound) {
            const savedChats = localStorage.getItem('llm_christmas_chats');
            if (savedChats) {
              try {
                const parsed = JSON.parse(savedChats) as ChatSession[];
                const nonEmpty = parsed
                  .filter(
                    (session) =>
                      session.messages?.length > 0 ||
                      (session.mcpIds && session.mcpIds.length > 0) ||
                      (session.skillIds && session.skillIds.length > 0),
                  )
                      .map((session) => ({
                    ...session,
                    messages: session.messages.map((m) => {
                      let next = m;
                      // Page refresh aborts in-flight streams. An incomplete flag
                      // without an active request would leave Process spinning forever.
                      if (m.role === 'assistant' && m.incomplete) {
                        next = {
                          ...next,
                          incomplete: true,
                          truncationReason:
                            m.truncationReason || 'Reply was interrupted',
                          toolRuns: (m.toolRuns || []).map((r) =>
                            r.status === 'start' ? { ...r, status: 'done' as const } : r,
                          ),
                        };
                      }
                      if (
                        next.role !== 'assistant' ||
                        (!contentHasThinkMarkup(next.content) &&
                          !contentHasToolMarkup(next.content))
                      ) {
                        return next;
                      }
                      const parts = displayAssistantParts(next);
                      return {
                        ...next,
                        content: parts.content,
                        reasoning: parts.reasoning || undefined,
                      };
                    }),
                  }));
                if (nonEmpty.length > 0) {
                  // Land on a blank New Chat draft (ChatGPT-style), not the
                  // most recent thread — history stays in the sidebar.
                  const draft: ChatSession = {
                    id: crypto.randomUUID(),
                    title: 'New Conversation',
                    messages: [],
                    updatedAt: Date.now(),
                  };
                  setSessions([draft, ...nonEmpty]);
                  setActiveSessionId(draft.id);
                } else {
                  createNewSession();
                }
              } catch {
                createNewSession();
              }
            } else {
              createNewSession();
            }
          } else {
            createNewSession();
          }
          setChatsHydrated(true);

          const boot: Array<Promise<unknown>> = [fetchModels()];
          if (bound) {
            boot.push(fetchSkills(), fetchIntegrations());
          }
          await Promise.all(boot);

          if (mainConnected) {
            setAccountError('');
            setShowAuthModal(false);
          }

          if (notionOk) {
            if (bound) {
              setAccountError('');
              setShowAuthModal(false);
            } else {
              setAuthModalMode('login');
              setAccountError(
                'Notion 已授权，但 llm.christmas 登录已失效。请先登录主站账号，再在 MCP 里重新连接 Notion。',
              );
              setShowAuthModal(true);
            }
            return;
          }

          if (githubOk) {
            if (bound) {
              setAccountError('');
              setShowAuthModal(false);
            } else {
              setAuthModalMode('login');
              setAccountError(
                'GitHub 已授权，但 llm.christmas 登录已失效。请先登录主站账号，再在 MCP 里重新连接 GitHub。',
              );
              setShowAuthModal(true);
            }
            return;
          }

          if (googleOk) {
            if (bound) {
              setAccountError('');
              setShowAuthModal(false);
              // Cookie was just set by the OAuth callback — refresh status.
              await fetchIntegrations();
              // First-time connect: enable all three surfaces on the newest chat
              // (index 0 after restore). Mount effect may have a stale activeSessionId.
              setSessions((prev) => {
                if (!prev.length) return prev;
                const target = prev[0];
                const ids = target.mcpIds || [];
                if (ids.some((id) => isGoogleMcpId(id))) return prev;
                const nextIds = [
                  ...ids.filter((id) => id !== 'google'),
                  'gmail',
                  'calendar',
                  'drive',
                ];
                return prev.map((s, i) =>
                  i === 0 ? { ...s, mcpIds: nextIds, updatedAt: Date.now() } : s,
                );
              });
            } else {
              setAuthModalMode('login');
              setAccountError(
                'Google 已授权，但 llm.christmas 登录已失效。请先登录主站账号，再在 MCP 里重新连接 Google。',
              );
              setShowAuthModal(true);
            }
            return;
          }

          if (authError) {
            setAccountError(authError);
            if (githubAuthReturn) setAuthModalMode('github');
            else if (googleAuthReturn) setAuthModalMode('google');
            else if (notionAuthReturn) setAuthModalMode('notion');
            else setAuthModalMode(bound ? 'notion' : 'login');
            setShowAuthModal(true);
            return;
          }

          if (notionAuthReturn && bound) {
            setAuthModalMode('notion');
            setShowAuthModal(true);
          }

          if (githubAuthReturn && bound) {
            setAuthModalMode('github');
            setShowAuthModal(true);
          }

          if (googleAuthReturn && bound) {
            setAuthModalMode('google');
            setShowAuthModal(true);
          }
        })
        .catch(() => {
          fetchModels();
          createNewSession();
          setChatsHydrated(true);
        });
    } catch {
      // ignore
    }
  }, []);

  // Save Sessions ONLY if account is bound — never persist empty drafts.
  // Wait until boot hydration finishes; otherwise isAccountBound flips true while
  // sessions is still [] and we wipe llm_christmas_chats from localStorage.
  useEffect(() => {
    if (!isAccountBound || !chatsHydrated) return;
    // Persist chats with messages, or drafts that already have per-chat MCP/Skills
    // enabled — otherwise toggling GitHub/Notion before the first send is lost on refresh.
    const persisted = sessions.filter(
      (session) =>
        session.messages.length > 0 ||
        (session.mcpIds && session.mcpIds.length > 0) ||
        (session.skillIds && session.skillIds.length > 0),
    );
    if (persisted.length > 0) {
      localStorage.setItem('llm_christmas_chats', JSON.stringify(persisted));
    } else {
      localStorage.removeItem('llm_christmas_chats');
    }
  }, [sessions, isAccountBound, chatsHydrated]);

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const messages = activeSession?.messages || [];

  useEffect(() => {
    if (!imagePreviewSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImagePreviewSrc(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imagePreviewSrc]);
  const activeSkillIds = activeSession?.skillIds || [];
  const activeMcpIds = activeSession?.mcpIds || [];
  const webSources = activeSession?.webSources || [];
  const userUploadReferences = useMemo(() => {
    const fromThread = collectUserUploadsFromMessages(messages);
    const seen = new Set(fromThread.map((s) => s.url || `${s.title}:${s.snippet?.slice(0, 40)}`));
    const pending: WebSearchSource[] = [];
    for (const a of attachments) {
      const url = a.fileId
        ? `/api/files/${encodeURIComponent(a.fileId)}`
        : a.previewUrl || a.dataUrl || '';
      const key = url || `pending:${a.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pending.push({
        title: a.name,
        url: isImageAttachment(a) ? url : '',
        snippet: a.text?.slice(0, 400) || '',
        provider: 'upload',
        query: 'upload',
        kind: isImageAttachment(a) ? 'image' : 'file',
      });
    }
    return [...fromThread, ...pending];
  }, [messages, attachments]);

  const referenceSourceGroups = useMemo(() => {
    const order: ExternalReferenceSourceKind[] = [
      'web',
      'notion',
      'github',
      'gmail',
      'calendar',
      'drive',
      'google',
    ];
    const grouped = new Map<ExternalReferenceSourceKind, WebSearchSource[]>();
    for (const source of webSources) {
      const kind: ExternalReferenceSourceKind =
        source.sourceKind && source.sourceKind !== 'upload'
          ? source.sourceKind
          : referenceSourceKind(source.provider, undefined);
      grouped.set(kind, [...(grouped.get(kind) || []), source]);
    }
    return order
      .map((kind) => ({ kind, sources: grouped.get(kind) || [] }))
      .filter((group) => group.sources.length > 0);
  }, [webSources]);

  const openUploadReference = (source: WebSearchSource) => {
    if (source.messageId) {
      const element = document.getElementById(`message-${source.messageId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.animate(
        [
          { backgroundColor: 'transparent' },
          { backgroundColor: 'rgba(245, 158, 11, 0.14)' },
          { backgroundColor: 'transparent' },
        ],
        { duration: 1200, easing: 'ease-out' },
      );
      return;
    }
    if (source.kind === 'image' && source.url) setImagePreviewSrc(source.url);
  };
  const notionMcpOn =
    Boolean(notionStatus?.connected) && activeMcpIds.includes('notion');
  const githubMcpOn =
    Boolean(githubStatus?.connected) && activeMcpIds.includes('github');
  const googleMcpConnected = Boolean(googleStatus?.connected);
  const gmailMcpOn = googleMcpConnected && activeMcpIds.includes('gmail');
  const calendarMcpOn = googleMcpConnected && activeMcpIds.includes('calendar');
  const driveMcpOn = googleMcpConnected && activeMcpIds.includes('drive');
  /** Zhipu Vision MCP — no OAuth, just needs a logged-in CPA account. */
  const zhipuVisionOn = isAccountBound && activeMcpIds.includes('zhipu-vision');

  const accountDisplayName =
    accountUsername || (isAccountBound ? t('accountConnected') : t('connectAccount'));

  // If Notion/GitHub/Google OAuth is gone, strip it from every chat's mcpIds.
  // Important: status starts as null (not yet fetched). Do NOT treat null as
  // "disconnected" or we wipe per-chat mcpIds before integrations load / on
  // transient fetch failures — which looks like the MCP toggle "won't save".
  useEffect(() => {
    if (notionStatus === null) return; // still loading
    if (notionStatus.connected) return;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (!(s.mcpIds || []).includes('notion')) return s;
        changed = true;
        return { ...s, mcpIds: (s.mcpIds || []).filter((id) => id !== 'notion') };
      });
      return changed ? next : prev;
    });
  }, [notionStatus]);

  useEffect(() => {
    if (githubStatus === null) return; // still loading
    if (githubStatus.connected) return;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (!(s.mcpIds || []).includes('github')) return s;
        changed = true;
        return { ...s, mcpIds: (s.mcpIds || []).filter((id) => id !== 'github') };
      });
      return changed ? next : prev;
    });
  }, [githubStatus]);

  useEffect(() => {
    if (googleStatus === null) return; // still loading
    if (googleStatus.connected) return;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (!(s.mcpIds || []).some((id) => isGoogleMcpId(id))) return s;
        changed = true;
        return { ...s, mcpIds: (s.mcpIds || []).filter((id) => !isGoogleMcpId(id)) };
      });
      return changed ? next : prev;
    });
  }, [googleStatus]);

  // Migrate legacy per-chat `google` toggle → gmail + calendar + drive.
  useEffect(() => {
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (!(s.mcpIds || []).includes('google')) return s;
        changed = true;
        return {
          ...s,
          mcpIds: normalizeGoogleIntegrations(s.mcpIds || []),
          updatedAt: Date.now(),
        };
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    // User explicitly cleared web sources — don't auto-restore from history.
    if (webSourcesCleared || activeSession?.webSourcesCleared) return;
    const collected = collectWebSourcesFromMessages(messages);
    const stored = activeSession?.webSources || [];
    const collectedKey = collected.map((c) => c.url).join('\n');
    const storedKey = stored.map((c) => c.url).join('\n');
    if (collectedKey === storedKey) return;
    const grew = collected.length > stored.length;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId ? { ...s, webSources: collected } : s,
      ),
    );
    if (grew && collected.length > 0) {
      queueMicrotask(() => setIsContextPanelOpen(true));
    }
  }, [activeSessionId, messages, activeSession?.webSources, webSourcesCleared]);
  const activeSkills = useMemo(
    () =>
      activeSkillIds
        .map((id) => skills.find((s) => s.id === id))
        .filter((s): s is SkillItem => Boolean(s)),
    [activeSkillIds, skills],
  );

  type GeneratedImageEntry = {
    messageId: string;
    imageIndex: number;
    url: string;
    prompt: string;
    model: string;
    timestamp: number;
  };

  const generatedImageHistory = useMemo((): GeneratedImageEntry[] => {
    const out: GeneratedImageEntry[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== 'assistant' || !m.images?.length) continue;
      const prev = messages[i - 1];
      const fromCmd =
        prev?.role === 'user' ? parseImageCommand(prev.content) : null;
      m.images.forEach((img, imageIndex) => {
        // Assistant images in this app are from /image; user uploads sit on user turns.
        out.push({
          messageId: m.id,
          imageIndex,
          url: img.url,
          prompt: img.prompt || fromCmd || img.name || 'Image',
          model: img.model || 'GPT Image',
          timestamp: m.timestamp,
        });
      });
    }
    return out.slice().reverse();
  }, [messages]);

  const formatGeneratedAt = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const downloadGeneratedImage = async (entry: GeneratedImageEntry) => {
    try {
      const res = await fetch(entry.url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `image-${entry.timestamp}.png`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(entry.url, '_blank', 'noopener,noreferrer');
    }
  };

  const removeGeneratedImage = (entry: GeneratedImageEntry) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const nextMessages = s.messages
          .map((m) => {
            if (m.id !== entry.messageId || !m.images?.length) return m;
            const images = m.images.filter((_, idx) => idx !== entry.imageIndex);
            return { ...m, images: images.length ? images : undefined };
          })
          .filter(
            (m) =>
              !(
                m.role === 'assistant' &&
                !m.content?.trim() &&
                !m.images?.length &&
                !m.reasoning &&
                !m.toolRuns?.length
              ),
          );
        return { ...s, messages: nextMessages, updatedAt: Date.now() };
      }),
    );
  };

  const clearGeneratedImages = () => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const nextMessages = s.messages
          .map((m) =>
            m.role === 'assistant' && m.images?.length
              ? { ...m, images: undefined }
              : m,
          )
          .filter(
            (m) =>
              !(
                m.role === 'assistant' &&
                !m.content?.trim() &&
                !m.images?.length &&
                !m.reasoning &&
                !m.toolRuns?.length
              ),
          );
        return { ...s, messages: nextMessages, updatedAt: Date.now() };
      }),
    );
  };

  const setActiveSkillIds = (updater: string[] | ((prev: string[]) => string[])) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const next = typeof updater === 'function' ? updater(s.skillIds || []) : updater;
        return { ...s, skillIds: next, updatedAt: Date.now() };
      }),
    );
  };

  const setActiveMcpIds = (updater: string[] | ((prev: string[]) => string[])) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const next = typeof updater === 'function' ? updater(s.mcpIds || []) : updater;
        return { ...s, mcpIds: next, updatedAt: Date.now() };
      }),
    );
  };

  const openLoginModal = () => {
    if (isAccountBound) return;
    setAuthModalMode('login');
    setShowAuthModal(true);
  };

  const openNotionModal = () => {
    if (!isAccountBound) {
      openLoginModal();
      return;
    }
    setAuthModalMode('notion');
    setShowAuthModal(true);
  };

  const openGitHubModal = () => {
    if (!isAccountBound) {
      openLoginModal();
      return;
    }
    setAuthModalMode('github');
    setShowAuthModal(true);
  };

  const openGoogleModal = () => {
    if (!isAccountBound) {
      openLoginModal();
      return;
    }
    setAuthModalMode('google');
    setShowAuthModal(true);
  };

  const closeAuthModal = () => {
    setShowAuthModal(false);
    setShowApiKeyLogin(false);
    setAuthModalMode('login');
  };

  const toggleNotionMcp = () => {
    if (notionMcpOn) {
      setActiveMcpIds((prev) => prev.filter((id) => id !== 'notion'));
      return;
    }
    if (!isAccountBound || !notionStatus?.connected) {
      openNotionModal();
      return;
    }
    setActiveMcpIds((prev) => (prev.includes('notion') ? prev : [...prev, 'notion']));
  };

  const setNotionMcpEnabled = (enabled: boolean) => {
    if (!enabled) {
      setActiveMcpIds((prev) => prev.filter((id) => id !== 'notion'));
      return;
    }
    if (!isAccountBound || !notionStatus?.connected) {
      openNotionModal();
      return;
    }
    setActiveMcpIds((prev) => (prev.includes('notion') ? prev : [...prev, 'notion']));
  };

  const setGitHubMcpEnabled = (enabled: boolean) => {
    if (!enabled) {
      setActiveMcpIds((prev) => prev.filter((id) => id !== 'github'));
      return;
    }
    if (!isAccountBound || !githubStatus?.connected) {
      openGitHubModal();
      return;
    }
    setActiveMcpIds((prev) => (prev.includes('github') ? prev : [...prev, 'github']));
  };

  const setGoogleServiceEnabled = (
    service: 'gmail' | 'calendar' | 'drive',
    enabled: boolean,
  ) => {
    if (!enabled) {
      setActiveMcpIds((prev) => prev.filter((id) => id !== service && id !== 'google'));
      return;
    }
    if (!isAccountBound || !googleStatus?.connected) {
      openGoogleModal();
      return;
    }
    setActiveMcpIds((prev) => {
      const withoutLegacy = prev.filter((id) => id !== 'google');
      return withoutLegacy.includes(service) ? withoutLegacy : [...withoutLegacy, service];
    });
  };

  const toggleSkill = (skillId: string) => {
    setActiveSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId],
    );
  };

  const attachSkill = (skill: SkillItem) => {
    setActiveSkillIds((prev) => (prev.includes(skill.id) ? prev : [...prev, skill.id]));
    setIsSkillPickerOpen(false);
  };

  /** Trailing `/query` at start of input or after a newline — slash-command mode. */
  const slashMatch = input.match(/(?:^|\n)\/([^\n]*)$/);
  const slashRaw = slashMatch ? slashMatch[1] : null;
  const slashQuery = slashRaw != null ? slashRaw.trim().toLowerCase() : null;
  /** True once the user typed a space after `/cmd` (arguments started). */
  const slashHasArgs = slashRaw != null && /\s/.test(slashRaw);

  type SlashMenuItem =
    | { kind: 'command'; id: string; title: string; insert: string; hint: string }
    | { kind: 'skill'; skill: SkillItem };

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
  }, [slashQuery, slashHasArgs, skills, isAccountBound]);

  const consumeSlashItem = (item: SlashMenuItem) => {
    if (item.kind === 'command') {
      setInput((prev) =>
        prev.replace(/(?:^|\n)\/[^\n]*$/, (seg) => (seg.startsWith('\n') ? `\n${item.insert}` : item.insert)),
      );
      setIsSkillPickerOpen(false);
      setSlashHighlight(0);
      return;
    }
    attachSkill(item.skill);
    setInput((prev) => prev.replace(/(?:^|\n)\/[^\n]*$/, (seg) => (seg.startsWith('\n') ? '\n' : '')));
    setSlashHighlight(0);
  };

  const isAssistantError = (m?: Message) =>
    Boolean(m && m.role === 'assistant' && (m.content || '').trim().startsWith('Error:'));
  const lastMessage = messages[messages.length - 1];
  const truncationInfo = useMemo(() => {
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return { truncated: false, reason: '' };
    }
    // Failed requests need Retry, not Continue-from-partial.
    if (isAssistantError(lastMessage)) {
      return { truncated: false, reason: '' };
    }
    // Refresh / navigate away mid-stream often leaves an empty incomplete bubble
    // (Process was spinning, no answer token yet). Offer Continue to re-run.
    if (lastMessage.incomplete && !String(lastMessage.content || '').trim()) {
      return {
        truncated: true,
        reason: lastMessage.truncationReason || 'Reply was interrupted',
      };
    }
    if (!lastMessage.content?.trim()) {
      return { truncated: false, reason: '' };
    }
    return analyzeTruncation(
      lastMessage.content,
      lastMessage.finishReason,
      lastMessage.incomplete,
      lastMessage.truncationReason,
    );
  }, [lastMessage]);
  // Only offer Continue when we have a clear interruption signal — not for every
  // finished assistant turn.
  const canResumeIncomplete = !isActiveLoading && truncationInfo.truncated;
  // Timeout / upstream failures leave an Error: bubble — offer Retry for that turn.
  const canRetryFailed = !isActiveLoading && isAssistantError(lastMessage);

  // After refresh / remount / lost tool-done events, orphan tool runs can stay at
  // status:"start" and spin forever. Close them whenever the session is idle.
  useEffect(() => {
    if (!chatsHydrated) return;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (loadingBySession[s.id]) return s;
        let sessionChanged = false;
        const messages = s.messages.map((m) => {
          if (m.role !== 'assistant') return m;
          const toolsNeedClose = (m.toolRuns || []).some((r) => r.status === 'start');
          const needsInterruptStamp = m.incomplete && !m.truncationReason;
          if (!toolsNeedClose && !needsInterruptStamp) return m;
          sessionChanged = true;
          changed = true;
          return {
            ...m,
            truncationReason: needsInterruptStamp
              ? m.truncationReason || 'Reply was interrupted'
              : m.truncationReason,
            toolRuns: (m.toolRuns || []).map((r) =>
              r.status === 'start'
                ? {
                    ...r,
                    status: 'done' as const,
                    error: r.error || 'Interrupted before results arrived',
                  }
                : r,
            ),
          };
        });
        return sessionChanged ? { ...s, messages } : s;
      });
      return changed ? next : prev;
    });
  }, [chatsHydrated, loadingBySession]);

  // Empty drafts stay in state for the composer, but do not appear in the sidebar
  // until the first message is sent. Order by last activity so resumed chats
  // jump back to the top of today's group.
  const sidebarSessions = useMemo(
    () =>
      [...sessions]
        .filter((session) => session.messages.length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  /** Local calendar day key (YYYY-MM-DD) for grouping. */
  const dayKeyOf = (ts: number) => {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const todayKey = dayKeyOf(Date.now());

  type SidebarDayGroup = { key: string; sessions: ChatSession[]; isToday: boolean };

  const sidebarDayGroups = useMemo(() => {
    const map = new Map<string, ChatSession[]>();
    for (const session of sidebarSessions) {
      const key = dayKeyOf(session.updatedAt);
      const list = map.get(key);
      if (list) list.push(session);
      else map.set(key, [session]);
    }
    const groups: SidebarDayGroup[] = [...map.entries()].map(([key, list]) => ({
      key,
      sessions: list,
      isToday: key === todayKey,
    }));
    // Keys are YYYY-MM-DD so string desc ≈ chronological desc.
    groups.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    return groups;
  }, [sidebarSessions, todayKey]);

  const formatDayGroupLabel = (key: string) => {
    if (key === todayKey) return t('today');
    const [ys, ms, ds] = key.split('-').map(Number);
    const date = new Date(ys, ms - 1, ds);
    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    if (
      date.getFullYear() === yesterday.getFullYear() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getDate() === yesterday.getDate()
    ) {
      return t('yesterday');
    }
    if (locale === 'zh') {
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const NEAR_BOTTOM_PX = 96;

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  };

  const scrollToBottom = (force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (!force && !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  };

  const handleMessagesScroll = () => {
    stickToBottomRef.current = isNearBottom();
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isActiveLoading]);

  // Switching conversations should land at the latest message.
  useEffect(() => {
    stickToBottomRef.current = true;
    scrollToBottom(true);
  }, [activeSessionId]);

  // While the assistant turn is still open but the stream has gone idle (no new
  // content / thought / tool), show a textless spinner under the bubble — including
  // the common gap after narration and before the next tool_call token.
  useEffect(() => {
    if (!isActiveLoading || !activeSessionId) {
      setReplyWaitByMessage({});
      return;
    }
    const session = sessionsRef.current.find((s) => s.id === activeSessionId);
    const msg = session?.messages[session.messages.length - 1];
    if (!msg || msg.role !== 'assistant' || !msg.incomplete) {
      setReplyWaitByMessage({});
      return;
    }
    const toolPending = (msg.toolRuns || []).some((r) => r.status === 'start');
    if (toolPending) {
      setReplyWaitByMessage((prev) => {
        if (!prev[msg.id]) return prev;
        const next = { ...prev };
        delete next[msg.id];
        return next;
      });
      return;
    }
    setReplyWaitByMessage((prev) => {
      if (!prev[msg.id]) return prev;
      const next = { ...prev };
      delete next[msg.id];
      return next;
    });
    // Mid-answer token gaps are often 1–2s; only treat longer stalls as a "wait"
    // (e.g. tool round). First-token wait uses awaitingFirstContent and does not
    // depend on this timer.
    const hasVisibleOutput =
      Boolean(String(msg.content || '').trim()) ||
      (msg.activity || []).some(
        (s) => s.kind === 'reasoning' && String(s.text || '').trim(),
      ) ||
      Boolean(String(msg.reasoning || '').trim());
    const idleMs = hasVisibleOutput ? 2800 : 500;
    const timer = window.setTimeout(() => {
      setReplyWaitByMessage((prev) =>
        prev[msg.id] ? prev : { ...prev, [msg.id]: true },
      );
    }, idleMs);
    return () => window.clearTimeout(timer);
  }, [
    isActiveLoading,
    activeSessionId,
    sessions
      .find((s) => s.id === activeSessionId)
      ?.messages.filter((m) => m.role === 'assistant')
      .slice(-1)
      .map((m) => {
        const tools = (m.toolRuns || [])
          .map((r) => `${r.id}:${r.status}`)
          .join(',');
        return `${m.id}:${m.content?.length || 0}:${m.reasoning?.length || 0}:${(m.activity || []).length}:${tools}`;
      })
      .join('|'),
  ]);

  // --- Actions ---
  const createNewSession = () => {
    // Switch to a blank composer. The draft is kept in memory only and is
    // omitted from the sidebar until the first message lands.
    setQuotedSelections([]);
    setSessions((prev) => {
      const emptyDraft = prev.find((session) => session.messages.length === 0);

      if (emptyDraft) {
        setActiveSessionId(emptyDraft.id);
        return prev
          .filter(
            (session) => session.messages.length > 0 || session.id === emptyDraft.id,
          )
          .map((session) =>
            session.id === emptyDraft.id
              ? { ...session, updatedAt: Date.now() }
              : session,
          );
      }

      const newSession: ChatSession = {
        id: crypto.randomUUID(),
        title: 'New Conversation',
        messages: [],
        updatedAt: Date.now(),
      };
      setActiveSessionId(newSession.id);
      // Drop any stray empty drafts while creating a fresh one.
      return [newSession, ...prev.filter((session) => session.messages.length > 0)];
    });
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  const updateSession = (sessionId: string, newMessages: Message[], title?: string) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === sessionId);
      let next: ChatSession[];
      if (!exists) {
        // First message on a missing draft — materialize the session now.
        const created: ChatSession = {
          id: sessionId || crypto.randomUUID(),
          title: title || 'New Conversation',
          messages: newMessages,
          updatedAt: Date.now(),
          webSources: collectWebSourcesFromMessages(newMessages),
        };
        if (!sessionId) setActiveSessionId(created.id);
        next = [created, ...prev.filter((s) => s.messages.length > 0)];
      } else {
        next = prev.map((s) => {
          if (s.id !== sessionId) return s;
          const collectedSources = collectWebSourcesFromMessages(newMessages);
          const retainedUrls = new Set(collectedSources.map((source) => source.url));
          return {
            ...s,
            messages: newMessages,
            title: title || s.title,
            updatedAt: Date.now(),
            // After an explicit clear, sources are an allowlist. On rollback/edit,
            // keep only allowlisted sources that still exist in the retained thread.
            webSources: s.webSourcesCleared
              ? (s.webSources || []).filter((source) => retainedUrls.has(source.url))
              : collectedSources,
          };
        });
      }
      // Same-tick readers (streamChatResponse / queue) must see truncated history
      // before React paints — otherwise rollback looks like only Material changed.
      sessionsRef.current = next;
      return next;
    });
  };

  const updateActiveSession = (newMessages: Message[], title?: string) => {
    updateSession(activeSessionId, newMessages, title);
  };

  const clearWebSources = () => {
    setWebSourcesCleared(true);
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, webSources: undefined, webSourcesCleared: true }
          : s,
      ),
    );
    setConfirmClearSourcesOpen(false);
  };

  const markAssistantIncomplete = (
    sessionId: string,
    assistantId: string,
    incomplete: boolean,
    meta?: { finishReason?: string | null; truncationReason?: string },
  ) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          updatedAt: Date.now(),
          messages: s.messages.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  incomplete,
                  finishReason: meta?.finishReason ?? m.finishReason,
                  truncationReason: incomplete ? meta?.truncationReason : undefined,
                }
              : m,
          ),
        };
      }),
    );
  };

  const appendToAssistant = (sessionId: string, assistantId: string, chunk: string) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        if (!s.messages.some((m) => m.id === assistantId)) return s;
        const msgs = s.messages.map((m) => {
          if (m.id !== assistantId) return m;
          const nextContent = stripMessageStamp(m.content + chunk);
          const activity = [...(m.activity || [])];
          const last = activity[activity.length - 1];
          // Mirror content into the timeline so Process / answer can interleave
          // in arrival order (think → answer → tool → answer…).
          if (last?.kind === 'content') {
            activity[activity.length - 1] = {
              ...last,
              text: last.text + chunk,
            };
          } else {
            activity.push({
              id: crypto.randomUUID(),
              kind: 'content',
              text: chunk,
            });
          }
          return { ...m, content: nextContent, activity, incomplete: true };
        });
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }),
    );
  };

  const appendToAssistantReasoning = (sessionId: string, assistantId: string, chunk: string) => {
    if (!chunk) return;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        if (!s.messages.some((m) => m.id === assistantId)) return s;
        const msgs = s.messages.map((m) => {
          if (m.id !== assistantId) return m;
          const activity = [...(m.activity || [])];
          const last = activity[activity.length - 1];
          // Only append to the last step when it is already reasoning.
          // After a tool runs, start a new reasoning step so the timeline stays
          // chronological: think → search → think (tool sits in the middle).
          if (last?.kind === 'reasoning') {
            activity[activity.length - 1] = {
              ...last,
              text: last.text + chunk,
            };
          } else {
            activity.push({
              id: crypto.randomUUID(),
              kind: 'reasoning',
              text: chunk,
            });
          }
          return {
            ...m,
            reasoning: (m.reasoning || '') + chunk,
            activity,
            incomplete: true,
          };
        });
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }),
    );
  };

  const upsertAssistantToolRun = (
    sessionId: string,
    assistantId: string,
    run: {
      name: string;
      status: 'start' | 'done';
      query?: string;
      provider?: string;
      results?: Array<{ title: string; url: string; snippet: string }>;
      error?: string;
      targetTimestamp?: number;
    },
  ) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        const msgs = s.messages.map((m) => {
          if (m.id !== assistantId) return m;
          const existing = m.toolRuns || [];
          const idx = existing.findIndex(
            (r) => r.name === run.name && r.query === run.query && r.status === 'start',
          );
          const pendingIdx =
            idx >= 0
              ? idx
              : run.status === 'done'
                ? existing.findIndex((r) => r.name === run.name && r.status === 'start')
                : -1;
          let toolRuns;
          let activity = [...(m.activity || [])];
          if (run.status === 'start') {
            const toolRunId = crypto.randomUUID();
            // A new start for the same tool while a previous one is still pending
            // usually means the earlier done was lost — close the orphan so it
            // doesn't spin forever under the new call.
            const closedOrphans = existing.map((r) =>
              r.name === run.name && r.status === 'start'
                ? {
                    ...r,
                    status: 'done' as const,
                    error: r.error || 'Superseded by a later call',
                  }
                : r,
            );
            toolRuns = [
              ...closedOrphans,
              {
                id: toolRunId,
                name: run.name,
                status: 'start' as const,
                query: run.query,
              },
            ];
            activity.push({
              id: crypto.randomUUID(),
              kind: 'tool',
              toolRunId,
            });
          } else if (pendingIdx >= 0) {
            toolRuns = existing.map((r, i) =>
              i === pendingIdx
                ? {
                    ...r,
                    status: 'done' as const,
                    provider: run.provider,
                    results: run.results,
                    error: run.error,
                  }
                : r,
            );
          } else {
            const toolRunId = crypto.randomUUID();
            toolRuns = [
              ...existing,
              {
                id: toolRunId,
                name: run.name,
                status: 'done' as const,
                query: run.query,
                provider: run.provider,
                results: run.results,
                error: run.error,
              },
            ];
            activity.push({
              id: crypto.randomUUID(),
              kind: 'tool',
              toolRunId,
            });
          }
          return { ...m, toolRuns, activity, incomplete: true };
        });
        let mergedMsgs = msgs;
        if (run.status === 'done') {
          const isImageUnderstand =
            run.name === 'image_understand' || run.provider === 'zhipu-vision';
          if (isImageUnderstand) {
            const { body, imageCount } = injectionBodyFromToolResults(run.results || []);
            if (body) {
              const aIdx = mergedMsgs.findIndex((m) => m.id === assistantId);
              // On-demand transcription of an older image (model-invoked tool):
              // results carry /api/files/<id> urls — persist onto the message
              // that owns that file so the image is only ever transcribed once.
              const runFileIds = (run.results || [])
                .map((r) => {
                  const u = String(r?.url || '');
                  return u.startsWith('/api/files/')
                    ? decodeURIComponent(
                        u.slice('/api/files/'.length).split(/[?#]/)[0] || '',
                      )
                    : '';
                })
                .filter(Boolean);
              let matchedByFileId = false;
              let targetIdx = -1;
              if (run.targetTimestamp != null) {
                targetIdx = mergedMsgs.findIndex(
                  (m) => m.role === 'user' && m.timestamp === run.targetTimestamp,
                );
              } else if (runFileIds.length > 0) {
                targetIdx = mergedMsgs.findIndex(
                  (m) =>
                    m.role === 'user' &&
                    (m.images || []).some(
                      (img) =>
                        (img.fileId && runFileIds.includes(img.fileId)) ||
                        runFileIds.some((id) =>
                          String(img.url || '').includes(id),
                        ),
                    ),
                );
                matchedByFileId = targetIdx >= 0;
              }
              if (targetIdx < 0) targetIdx = aIdx - 1;
              if (targetIdx >= 0 && mergedMsgs[targetIdx]?.role === 'user') {
                const userMsg = mergedMsgs[targetIdx];
                // A single on-demand call covers one image; only persist when it
                // covers ALL images of that message, otherwise a partial
                // transcription would hide the remaining ones from text models.
                const coversAllImages =
                  !matchedByFileId ||
                  (userMsg.images?.length || 0) <= (run.results?.length || 0);
                if (coversAllImages &&
                    !hasPersistedImageTranscription(userMsg.content || '') &&
                    (userMsg.images?.length || 0) > 0) {
                  mergedMsgs = mergedMsgs.map((m, i) =>
                    i === targetIdx
                      ? {
                          ...userMsg,
                          content: buildPersistedUserMessageContent(
                            userMsg.content,
                            body,
                            imageCount || run.results?.length || 1,
                            imageRefsFromMessageImages(userMsg.images),
                          ),
                          // Keep thumbnails in UI; API drops images once transcription is present.
                        }
                      : m,
                  );
                }
              }
            }
          } else {
            const nextSession = { ...s, messages: mergedMsgs, updatedAt: Date.now() };
            if (s.webSourcesCleared) {
              const sourceByUrl = new Map((s.webSources || []).map((source) => [source.url, source]));
              for (const result of run.results || []) {
                if (!result.url || /^(data:|blob:|\/)/i.test(result.url)) continue;
                sourceByUrl.set(result.url, {
                  title: result.title,
                  url: result.url,
                  snippet: result.snippet,
                  provider: run.provider,
                  query: run.query,
                  sourceKind: referenceSourceKind(run.provider, run.name),
                });
              }
              nextSession.webSources = [...sourceByUrl.values()].slice(-40);
            } else {
              nextSession.webSources = collectWebSourcesFromMessages(mergedMsgs);
            }
            if ((nextSession.webSources?.length || 0) > 0) {
              if (!s.webSourcesCleared) setWebSourcesCleared(false);
              queueMicrotask(() => setIsContextPanelOpen(true));
            }
            return nextSession;
          }
        }
        const nextSession = { ...s, messages: mergedMsgs, updatedAt: Date.now() };
        return nextSession;
      }),
    );
  };

  const streamChatResponse = async (
    sessionId: string,
    apiMessages: ReturnType<typeof toApiMessages>,
    assistantId: string,
    signal: AbortSignal,
    /** Text already present in the bubble, so Resume analyzes the whole reply. */
    initialContent = '',
    /** Inserted before the first resumed chunk to keep Markdown structure intact. */
    seamPrefix = '',
    /** Prefer sources from the truncated thread (edit/resend), not a stale ref. */
    webSourcesOverride?: WebSearchSource[],
  ) => {
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    const sessionSources = webSourcesOverride ?? session?.webSources ?? [];
    const combinedReference = formatWebSourcesForReference(sessionSources);

    const notionConnected = Boolean(notionStatusRef.current?.connected);
    const githubConnected = Boolean(githubStatusRef.current?.connected);
    const googleConnected = Boolean(googleStatusRef.current?.connected);
    const integrations = normalizeGoogleIntegrations(
      sessionsRef.current.find((s) => s.id === sessionId)?.mcpIds || [],
    ).filter((id) => {
      if (id === 'notion') return notionConnected;
      if (id === 'github') return githubConnected;
      if (id === 'gmail' || id === 'calendar' || id === 'drive') return googleConnected;
      // No OAuth — server authorizes via bound CPA key.
      if (id === 'zhipu-vision') return true;
      return false;
    });

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: apiMessages,
        model: selectedModel,
        systemPrompt,
        referenceText: combinedReference,
        skills: skillsPayloadForSession(sessionId),
        conversationId: sessionId,
        integrations,
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || 'Upstream error');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason: string | null = null;
    let serverTruncated: boolean | null = null;
    let serverTruncationReason: string | undefined;
    let seamPending = Boolean(seamPrefix);
    let sawDone = false;
    const thinkParser = createThinkStreamParser();
    const toolStripper = createToolCallStripper();

    // Clean any leaked <think> / fake tool markup already in the bubble (history / Resume).
    const seededThink = extractThinkBlocks(initialContent);
    const seededContent = stripFakeToolMarkup(seededThink.content);
    let streamed = seededContent;
    if (contentHasThinkMarkup(initialContent) || contentHasToolMarkup(initialContent)) {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: s.messages.map((m) => {
              if (m.id !== assistantId) return m;
              const mergedReasoning = [m.reasoning, seededThink.reasoning]
                .filter(Boolean)
                .join('\n\n');
              return {
                ...m,
                content: seededContent,
                reasoning: mergedReasoning || undefined,
              };
            }),
          };
        }),
      );
    }
    // Keep parsers in sync if the previous reply was cut mid-tag.
    if (initialContent) {
      const seededSplit = thinkParser.push(initialContent);
      if (seededSplit.content) toolStripper.push(seededSplit.content);
    }

    const emitContent = (chunk: string) => {
      const cleaned = toolStripper.push(chunk);
      if (!cleaned) return;
      streamed += cleaned;
      appendToAssistant(sessionId, assistantId, cleaned);
      if (sessionId === activeSessionIdRef.current) scrollToBottom();
    };

    const applyThinkSplit = (raw: string) => {
      const split = thinkParser.push(raw);
      if (split.reasoning) {
        appendToAssistantReasoning(sessionId, assistantId, split.reasoning);
      }
      if (split.content) emitContent(split.content);
    };

    const settle = (unexpectedEnd = false) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const msgs = s.messages.map((m) => {
            if (m.id !== assistantId || !m.toolRuns?.some((r) => r.status === 'start')) return m;
            return {
              ...m,
              toolRuns: m.toolRuns.map((r) =>
                r.status === 'start' ? { ...r, status: 'done' as const } : r,
              ),
            };
          });
          return { ...s, messages: msgs };
        }),
      );

      const flushed = thinkParser.flush();
      if (flushed.reasoning) appendToAssistantReasoning(sessionId, assistantId, flushed.reasoning);
      if (flushed.content) {
        const cleaned = toolStripper.push(flushed.content) + toolStripper.flush();
        if (cleaned) {
          streamed += cleaned;
          appendToAssistant(sessionId, assistantId, cleaned);
        }
      } else {
        const cleaned = toolStripper.flush();
        if (cleaned) {
          streamed += cleaned;
          appendToAssistant(sessionId, assistantId, cleaned);
        }
      }

      // Safety net: some gateways put the whole answer in reasoning with empty
      // content. Promote it to the bubble body so the UI is not "Thought only".
      if (!streamed.trim()) {
        const live = sessionsRef.current
          .find((s) => s.id === sessionId)
          ?.messages.find((m) => m.id === assistantId);
        const orphan = String(live?.reasoning || '').trim();
        if (orphan) {
          streamed = orphan;
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              return {
                ...s,
                updatedAt: Date.now(),
                messages: s.messages.map((m) => {
                  if (m.id !== assistantId) return m;
                  return {
                    ...m,
                    content: orphan,
                    reasoning: undefined,
                    activity: (m.activity || []).filter((a) => a.kind !== 'reasoning'),
                  };
                }),
              };
            }),
          );
        }
      }

      // Truly empty reply (no content, no reasoning): never leave a blank bubble.
      // Treat as a failed request so the user sees Retry instead of empty space.
      if (!streamed.trim()) {
        const fallback =
          'Error: The model returned an empty reply. Please try again, or switch to another model.';
        streamed = fallback;
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              updatedAt: Date.now(),
              messages: s.messages.map((m) => {
                if (m.id !== assistantId) return m;
                return {
                  ...m,
                  content: fallback,
                  incomplete: false,
                  truncationReason: undefined,
                };
              }),
            };
          }),
        );
        markAssistantIncomplete(sessionId, assistantId, false, {
          finishReason: finishReason || 'error',
        });
        return;
      }

      // Connection dropped / function killed mid-stream: no [DONE] arrived.
      // Prefer Continue over silently treating the partial reply as finished.
      if (unexpectedEnd && !finishReason && serverTruncated == null) {
        markAssistantIncomplete(sessionId, assistantId, true, {
          finishReason,
          truncationReason: 'Stream ended unexpectedly',
        });
        return;
      }
      const verdict = analyzeTruncation(
        streamed,
        finishReason,
        unexpectedEnd || thinkParser.inThink,
        undefined,
        {
          serverTruncated,
          serverReason: serverTruncationReason,
        },
      );
      markAssistantIncomplete(sessionId, assistantId, verdict.truncated, {
        finishReason,
        truncationReason: verdict.reason || undefined,
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') {
          sawDone = true;
          settle(false);
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.finish_reason) finishReason = parsed.finish_reason;
          if (typeof parsed.truncated === 'boolean') {
            serverTruncated = parsed.truncated;
          }
          if (typeof parsed.truncation_reason === 'string' && parsed.truncation_reason) {
            serverTruncationReason = parsed.truncation_reason;
          }
          if (parsed.reasoning) {
            appendToAssistantReasoning(sessionId, assistantId, parsed.reasoning);
          }
          if (parsed.tool) {
            upsertAssistantToolRun(sessionId, assistantId, {
              name: String(parsed.tool.name || 'web_search'),
              status: parsed.tool.status === 'done' ? 'done' : 'start',
              query: parsed.tool.query,
              provider: parsed.tool.provider,
              results: Array.isArray(parsed.tool.results) ? parsed.tool.results : undefined,
              error: parsed.tool.error,
              targetTimestamp:
                typeof parsed.tool.targetTimestamp === 'number'
                  ? parsed.tool.targetTimestamp
                  : undefined,
            });
          }
          if (parsed.content) {
            let chunk = parsed.content as string;
            if (seamPending) {
              seamPending = false;
              // Skip the seam if the model already emitted the break itself.
              if (!chunk.startsWith('\n')) chunk = seamPrefix + chunk;
            }
            applyThinkSplit(chunk);
          }
        } catch (e) {}
      }
    }

    settle(!sawDone);
  };

  const deleteSession = (id: string) => {
    const controller = abortControllersRef.current.get(id);
    if (controller) controller.abort();
    endLoading(id);
    setMessageQueue((prev) => prev.filter((task) => task.sessionId !== id));
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id && s.messages.length > 0);

      if (filtered.length === 0) {
        const emptyDraft: ChatSession = {
          id: crypto.randomUUID(),
          title: 'New Conversation',
          messages: [],
          updatedAt: Date.now(),
        };
        setActiveSessionId(emptyDraft.id);
        return [emptyDraft];
      }

      if (activeSessionId === id) {
        // After deleting the active chat, return to a blank New Chat draft.
        const emptyDraft: ChatSession = {
          id: crypto.randomUUID(),
          title: 'New Conversation',
          messages: [],
          updatedAt: Date.now(),
        };
        setActiveSessionId(emptyDraft.id);
        return [emptyDraft, ...filtered];
      }

      return filtered;
    });
    setSessionPendingDelete(null);
    setSessionMenuOpenId(null);
  };

  const saveUserKey = async () => {
    const trimmed = tempKeyInput.trim();
    setAccountError('');
    setAccountSaving(true);
    try {
      const response = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || '绑定失败');
      setTempKeyInput('');
      closeAuthModal();
      if (data?.username) setAccountUsername(String(data.username));
      await refreshAccountStatus();
      await fetchModels();
      await fetchSkills();
      await fetchIntegrations();
    } catch (error: any) {
      setAccountError(error?.message || '绑定失败');
    } finally {
      setAccountSaving(false);
    }
  };

  const disconnectAccount = async () => {
    await fetch('/api/account', { method: 'DELETE' });
    setIsAccountBound(false);
    setAccountUsername(null);
    setTempKeyInput('');
    setActiveMcpIds((prev) => prev.filter((id) => id !== 'zhipu-vision'));
    closeAuthModal();
    setNotionStatus(null);
    setGitHubStatus(null);
    setGoogleStatus(null);
    setSessions([]);
    setSkills([]);
    createNewSession();
    await fetchModels();
  };

  const applyIngestedFiles = async (
    files: FileList | File[],
    append: (placeholders: IngestedAttachment[]) => void,
    patch: (id: string, updater: (x: IngestedAttachment) => IngestedAttachment) => void,
  ) => {
    setAttachError('');
    const { attachments: next, errors } = await ingestFiles(files);

    const placeholders: IngestedAttachment[] = next.map((a) => ({
      ...a,
      uploading: Boolean(a.dataUrl && isAccountBound),
    }));

    if (placeholders.length > 0) {
      append(placeholders);
    }

    for (const a of next) {
      if (!a.dataUrl || !isAccountBound) continue;

      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl: a.dataUrl, filename: a.name }),
        });
        const data = await res.json();
        if (res.ok && data?.id) {
          const fileId = String(data.id);
          patch(a.id, (x) => ({
            ...x,
            uploading: false,
            uploadError: false,
            fileId,
            previewUrl: `/api/files/${encodeURIComponent(fileId)}`,
          }));
          continue;
        }
        if (isAccountBound) {
          patch(a.id, (x) => ({ ...x, uploading: false, uploadError: !x.dataUrl }));
          continue;
        }
      } catch {
        if (isAccountBound) {
          patch(a.id, (x) => ({ ...x, uploading: false, uploadError: !x.dataUrl }));
          continue;
        }
      }

      patch(a.id, (x) => ({ ...x, uploading: false }));
    }
    if (errors.length > 0) setAttachError(errors.join(' · '));
  };

  const addIngestedFiles = async (files: FileList | File[]) => {
    await applyIngestedFiles(
      files,
      (placeholders) => {
        setAttachments((prev) => [...prev, ...placeholders]);
        setAttachmentsExpanded(true);
      },
      (id, updater) => setAttachments((prev) => prev.map((x) => (x.id === id ? updater(x) : x))),
    );
  };

  const addEditIngestedFiles = async (files: FileList | File[]) => {
    await applyIngestedFiles(
      files,
      (placeholders) => setEditingMessageAttachments((prev) => [...prev, ...placeholders]),
      (id, updater) =>
        setEditingMessageAttachments((prev) => prev.map((x) => (x.id === id ? updater(x) : x))),
    );
  };

  const removeEditingMessageAttachment = (id: string) => {
    setEditingMessageAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  const removeAttachment = (id: string) => {
    const toRemove = attachments.find((a) => a.id === id);
    if (toRemove?.previewUrl) URL.revokeObjectURL(toRemove.previewUrl);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const selectedSpec = useMemo(() => {
    const fromList = availableModels.find((m) => m.id === selectedModel);
    const fallback = getModelSpec(selectedModel);
    return {
      context: fromList?.context_window ?? fallback.context,
      maxOutput: fromList?.max_output ?? fallback.maxOutput,
      // Prefer explicit list flag; fall back to local specs so we don't
      // treat vision models as text-only when the API field is missing.
      vision: fromList?.vision ?? fallback.vision,
    };
  }, [availableModels, selectedModel]);

  const hasImages = useMemo(
    () => sessionHasImages(messages, attachments),
    [messages, attachments],
  );
  /** Soft-allow text models with images when Zhipu Vision MCP is on. */
  const imagesBlockTextModel = hasImages && !selectedSpec.vision && !zhipuVisionOn;
  const imagesPreferVision = hasImages && !selectedSpec.vision && zhipuVisionOn;

  // Close model menu on outside click / Escape.
  useEffect(() => {
    if (!isModelMenuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (modelMenuRef.current && target && !modelMenuRef.current.contains(target)) {
        setIsModelMenuOpen(false);
        setModelSearchQuery('');
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsModelMenuOpen(false);
        setModelSearchQuery('');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isModelMenuOpen]);

  // Close account menu on outside click / Escape.
  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (accountMenuRef.current && target && !accountMenuRef.current.contains(target)) {
        setIsAccountMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isAccountMenuOpen]);

  // Close session "more" menu on outside click / Escape.
  useEffect(() => {
    if (!sessionMenuOpenId) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(`[data-session-menu="${sessionMenuOpenId}"]`) ||
        target.closest(`[data-session-menu-trigger="${sessionMenuOpenId}"]`)
      ) {
        return;
      }
      setSessionMenuOpenId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSessionMenuOpenId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [sessionMenuOpenId]);

  // Focus search when the model menu opens.
  useEffect(() => {
    if (!isModelMenuOpen) return;
    const timer = window.setTimeout(() => modelSearchRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [isModelMenuOpen]);

  // Keep <html lang> in sync with UI locale.
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const filteredModels = useMemo(() => {
    const q = modelSearchQuery.trim().toLowerCase();
    if (!q) return availableModels;
    return availableModels.filter((m) => m.id.toLowerCase().includes(q));
  }, [availableModels, modelSearchQuery]);

  // When images appear on a text-only model:
  // - Zhipu Vision MCP off → hard block (must switch to vision)
  // - Zhipu Vision MCP on → soft suggestion (bridge via GLM-4.6V)
  useEffect(() => {
    if (imagesBlockTextModel) {
      setAttachError(t('imagesNeedVision'));
      return;
    }
    if (imagesPreferVision) {
      setAttachError(t('imagesPreferVision'));
      return;
    }
    setAttachError((prev) =>
      prev === t('imagesNeedVision') ||
      prev === t('imagesPreferVision') ||
      prev === 'This conversation has images. Pick a Vision model to continue.' ||
      prev === 'This conversation has images — switch to a vision-capable model.'
        ? ''
        : prev,
    );
  }, [imagesBlockTextModel, imagesPreferVision, t, locale]);

  // When the selected chat model is already Vision-capable, Image Understand
  // would be redundant (and may cause double work). Auto-disable the MCP.
  useEffect(() => {
    if (!selectedSpec.vision) return;
    if (!zhipuVisionOn) return;
    setActiveMcpIds((prev) => prev.filter((id) => id !== 'zhipu-vision'));
  }, [selectedSpec.vision, zhipuVisionOn]);

  // Conversation already has images + switch (or land) on a text-only model:
  // turn Image Understand on immediately so the chat stays usable. Guests still
  // must pick a Vision model (no MCP billing account).
  useEffect(() => {
    if (!isAccountBound) return;
    if (selectedSpec.vision) return;
    if (!hasImages) return;
    if (zhipuVisionOn) return;
    setActiveMcpIds((prev) =>
      prev.includes('zhipu-vision') ? prev : [...prev, 'zhipu-vision'],
    );
  }, [isAccountBound, selectedSpec.vision, hasImages, zhipuVisionOn]);

  // Token estimate aligned with what the server actually sends.
  const contextBreakdown = useMemo(() => {
    const systemText = (systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT);
    const system = estimateTokensFromText(systemText);
    const skillTokens = activeSkills.reduce(
      (sum, s) => sum + estimateTokensFromText(`${s.title}\n${s.content}`) + 8,
      0,
    );
    const reference = estimateTokensFromText(formatWebSourcesForReference(webSources));
    const files = estimateTokensFromText(
      attachments
        .filter((a) => a.text)
        .map((a) => `${a.name}\n${a.text}`)
        .join('\n\n'),
    );
    // Images are roughly ~1k tokens each for budgeting (provider-dependent).
    const imageTokens =
      attachments.filter((a) => a.dataUrl).length * 1000 +
      messages.reduce((sum, m) => sum + (m.images?.length || 0) * 1000, 0);
    const conversation = messages.reduce(
      (sum, m) => sum + estimateTokensFromText(messagePlainText(m)) + 4,
      0,
    );
    return {
      system,
      skills: skillTokens,
      reference,
      files,
      images: imageTokens,
      conversation,
      total: system + skillTokens + reference + files + imageTokens + conversation,
    };
  }, [messages, systemPrompt, webSources, attachments, activeSkills]);

  const estimatedTokens = contextBreakdown.total;
  const contextLimit = selectedSpec.context;
  const outputReserve = Math.min(selectedSpec.maxOutput || 8192, 8192);
  const usableLimit =
    contextLimit != null ? Math.max(contextLimit - outputReserve, 1) : null;
  const usageRatio =
    usableLimit != null ? Math.min(estimatedTokens / usableLimit, 1.5) : null;

  const contextSources = useMemo(
    () =>
      (
        [
          ['System', contextBreakdown.system],
          ['Skills', contextBreakdown.skills],
          ['Reference', contextBreakdown.reference],
          ['Files', contextBreakdown.files],
          ['Images', contextBreakdown.images],
          ['Conversation', contextBreakdown.conversation],
        ] as Array<[string, number]>
      ).filter(([, tokens]) => tokens > 0),
    [contextBreakdown],
  );

  const SYSTEM_PRESETS = [
    { label: 'Concise', value: 'Answer concisely. Prefer short, direct sentences and skip preamble.' },
    { label: 'Chinese', value: '始终使用简体中文回答，除代码与专有名词外不要混用英文。' },
    { label: 'Engineer', value: 'You are a senior engineer. Give production-ready code, name tradeoffs, and flag edge cases.' },
    { label: 'Explain', value: 'Explain step by step with concrete examples, assuming a smart beginner.' },
  ];

  // Fetch dynamic models from backend. The server decides free/full access from its HttpOnly cookie.
  const fetchModels = async () => {
    setModelsLoading(true);
    try {
      const res = await fetch('/api/models', {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && Array.isArray(data.models)) {
        setAvailableModels(data.models);
        if (data.models.length > 0) {
          setSelectedModel((prev) => {
            if (prev && data.models.some((m: ModelOption) => m.id === prev)) return prev;
            let saved = '';
            try {
              saved = localStorage.getItem('llm_christmas_selected_model') || '';
            } catch {}
            if (saved && data.models.some((m: ModelOption) => m.id === saved)) return saved;
            return data.models[0].id;
          });
        } else {
          setSelectedModel('');
        }
      } else {
        console.error('Failed to fetch models', data?.error || res.status);
      }
    } catch (e) {
      console.error('Failed to fetch models', e);
    } finally {
      setModelsLoading(false);
    }
  };

  const fetchSkills = async () => {
    try {
      const res = await fetch('/api/skills', { cache: 'no-store' });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSkills(json.data);
      }
    } catch (e) {
      console.error('Failed to fetch skills', e);
    }
  };

  const openNewSkillModal = () => {
    setSkillDraftTitle('');
    setSkillDraftContent('');
    setSkillDraftBrief('');
    setSkillModalError('');
    setShowSkillModal(true);
  };

  const createSkill = async (title: string, content: string) => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
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
        body: JSON.stringify({ title: trimmedTitle, content: trimmedContent }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '保存失败');
      if (json.success || json.data) {
        const saved = json.data || { id: crypto.randomUUID(), title: trimmedTitle, content: trimmedContent };
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
  };

  const generateSkillWithAI = async () => {
    const brief = skillDraftBrief.trim() || skillDraftTitle.trim();
    if (!brief) {
      setSkillModalError('先用一句话描述这个 Skill 要做什么');
      return;
    }
    setIsGeneratingSkill(true);
    setSkillModalError('');
    try {
      const res = await fetch('/api/skills/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, model: selectedModel || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '生成失败');
      if (json.title) setSkillDraftTitle(json.title);
      if (json.content) setSkillDraftContent(json.content);
    } catch (e: any) {
      setSkillModalError(e?.message || '生成失败');
    } finally {
      setIsGeneratingSkill(false);
    }
  };

  const requestDeleteSkill = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const skill = skills.find((s) => s.id === id) || null;
    if (!skill) return;
    setSkillPendingDelete(skill);
  };

  const confirmDeleteSkill = async () => {
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
  };

  // Remember the user's model choice across refreshes.
  useEffect(() => {
    if (!selectedModel) return;
    localStorage.setItem('llm_christmas_selected_model', selectedModel);
  }, [selectedModel]);

  // Keep slash highlight in range when the filtered list shrinks.
  useEffect(() => {
    setSlashHighlight(0);
  }, [slashQuery]);

  // Close skill picker on outside click.
  useEffect(() => {
    if (!isSkillPickerOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (skillPickerRef.current && target && !skillPickerRef.current.contains(target)) {
        setIsSkillPickerOpen(false);
        setPlusFlyout(null);
        plusMenuButtonRef.current?.blur();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [isSkillPickerOpen]);

  // Floating "Quote" button when selecting text inside the message list.
  // Shown/positioned via DOM only — no setState — so React re-renders cannot
  // collapse the browser selection highlight.
  useEffect(() => {
    let raf = 0;
    const wrap = () => quoteToolbarWrapRef.current;

    const hideToolbar = () => {
      const el = wrap();
      if (el) el.style.display = 'none';
      quoteToolbarTextRef.current = '';
    };

    const updateFromSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        hideToolbar();
        return;
      }
      const text = markdownFromDomSelection(sel);
      if (!text) {
        hideToolbar();
        return;
      }
      const root = messagesContentRef.current;
      if (!root) {
        hideToolbar();
        return;
      }
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) {
        hideToolbar();
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        hideToolbar();
        return;
      }
      const clipped = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
      const x = Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2));
      // Sit just above the selection; wrapper uses translate(-50%, -100%).
      const y = Math.max(8, rect.top - 10);
      const el = wrap();
      if (el) {
        el.style.display = 'block';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      }
      quoteToolbarTextRef.current = clipped;
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateFromSelection);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideToolbar();
      else if (e.shiftKey || e.key.startsWith('Arrow')) scheduleUpdate();
    };

    document.addEventListener('selectionchange', scheduleUpdate);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mouseup', scheduleUpdate);
    const scroller = scrollRef.current;
    scroller?.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('selectionchange', scheduleUpdate);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mouseup', scheduleUpdate);
      scroller?.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, []);

  const MAX_QUOTED_SELECTIONS = 8;

  const quoteSelectedText = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setQuotedSelections((prev) => {
      if (prev.some((q) => q === clean)) return prev;
      if (prev.length >= MAX_QUOTED_SELECTIONS) {
        return [...prev.slice(1), clean];
      }
      return [...prev, clean];
    });
    quoteToolbarTextRef.current = '';
    const el = quoteToolbarWrapRef.current;
    if (el) el.style.display = 'none';
    window.getSelection()?.removeAllRanges();
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const removeQuotedSelection = (index: number) => {
    setQuotedSelections((prev) => prev.filter((_, i) => i !== index));
  };

  /** Encode one or more quotes as Markdown blockquotes ahead of the user body. */
  const formatQuotedMessage = (userText: string, quotes: string | string[]) => {
    const list = (Array.isArray(quotes) ? quotes : [quotes])
      .map((q) => q.trim())
      .filter(Boolean);
    const body = userText.trim();
    if (!list.length) return body;
    const blocks = list
      .map((q) =>
        q
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n'),
      )
      .join('\n\n');
    return body ? `${blocks}\n\n${body}` : blocks;
  };

  /** Split a sent user message that was built by formatQuotedMessage into quotes + body. */
  const parseQuotedUserMessage = (content: string): { quotes: string[]; body: string } => {
    const text = String(content || '');
    if (!text.startsWith('>')) return { quotes: [], body: text };
    const lines = text.split('\n');
    const quotes: string[] = [];
    let current: string[] = [];
    let i = 0;

    const flush = () => {
      const q = current.join('\n').trim();
      if (q) quotes.push(q);
      current = [];
    };

    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('> ') || line === '>') {
        current.push(line.startsWith('> ') ? line.slice(2) : '');
        continue;
      }
      if (line.trim() === '') {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j += 1;
        if (j < lines.length && (lines[j].startsWith('> ') || lines[j] === '>')) {
          flush();
          i = j - 1;
          continue;
        }
        flush();
        i = j;
        break;
      }
      flush();
      break;
    }
    while (i < lines.length && lines[i].trim() === '') i += 1;
    return {
      quotes,
      body: lines.slice(i).join('\n'),
    };
  };

  const beginLoading = (sessionId: string) => {
    setLoadingBySession((prev) => ({ ...prev, [sessionId]: true }));
  };

  const endLoading = (sessionId: string) => {
    setLoadingBySession((prev) => {
      if (!prev[sessionId]) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    abortControllersRef.current.delete(sessionId);
  };

  /** Only clear loading if this controller is still the active one for the session.
   *  Prevents a stopped/aborted request's finally from wiping a newer in-flight request. */
  const endLoadingIfController = (sessionId: string, controller: AbortController) => {
    if (abortControllersRef.current.get(sessionId) !== controller) return;
    endLoading(sessionId);
  };

  const skillsPayloadForSession = (sessionId: string) => {
    const ids = sessionsRef.current.find((s) => s.id === sessionId)?.skillIds || [];
    return ids
      .map((id) => skillsRef.current.find((s) => s.id === id))
      .filter((s): s is SkillItem => Boolean(s))
      .map((s) => ({ title: s.title, content: s.content }));
  };

  // --- Chat Logic ---
  // Drain each session's queue only when that session is idle and not paused.
  useEffect(() => {
    const toStart: QueuedTask[] = [];
    const seen = new Set<string>();
    for (const task of messageQueue) {
      if (seen.has(task.sessionId)) continue;
      if (loadingBySession[task.sessionId] || queuePausedBySession[task.sessionId]) continue;
      seen.add(task.sessionId);
      toStart.push(task);
    }
    if (toStart.length === 0) return;
    const ids = new Set(toStart.map((task) => task.id));
    setMessageQueue((prev) => prev.filter((task) => !ids.has(task.id)));
    for (const task of toStart) {
      // Reserve the session slot immediately so another drain can't double-start
      // while handleSubmit awaits compact / network.
      beginLoading(task.sessionId);
      void (async () => {
        const ok = await handleSubmit(task.content, task.baseMessages, false, task.sessionId, {
          alreadyLoading: true,
        });
        if (!ok) {
          endLoading(task.sessionId);
          setMessageQueue((prev) => [
            ...prev,
            { ...task, id: crypto.randomUUID(), enqueueTime: Date.now() },
          ]);
        }
      })();
    }
  }, [messageQueue, loadingBySession, queuePausedBySession]);

  const enqueueOrSubmit = (overrideInput?: string, baseMessagesOverride?: Message[]) => {
    const fromComposer = overrideInput == null;
    const raw = overrideInput ?? input;
    const quotes = fromComposer ? quotedSelections : [];
    const textToSend = formatQuotedMessage(raw, quotes);
    const hasPending = fromComposer && attachments.length > 0;
    if (!textToSend.trim() && !hasPending) return;
    const sessionId = activeSessionId;

    if (isSessionLoading(sessionId)) {
      if (!textToSend.trim()) return;
      const now = Date.now();
      const sessionQueue = messageQueue.filter((task) => task.sessionId === sessionId);
      const lastInQueue = sessionQueue[sessionQueue.length - 1];
      if (lastInQueue && lastInQueue.content === textToSend.trim() && now - lastInQueue.enqueueTime < 500) {
        return;
      }
      setMessageQueue((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          sessionId,
          content: textToSend.trim(),
          // Snapshot this session's thread so a later drain cannot pick up
          // another conversation via a stale active-session fallback.
          baseMessages:
            baseMessagesOverride ??
            sessionsRef.current.find((s) => s.id === sessionId)?.messages,
          enqueueTime: now,
        },
      ]);
      if (fromComposer) {
        setInput('');
        setQuotedSelections([]);
      }
      return;
    }

    if (fromComposer) {
      setInput('');
      setQuotedSelections([]);
    }
    beginLoading(sessionId);
    void handleSubmit(textToSend, baseMessagesOverride, false, sessionId, {
      alreadyLoading: true,
    }).then((ok) => {
      if (!ok) endLoading(sessionId);
    });
  };

  const cancelQueuedMessage = (id: string) => {
    setMessageQueue((prev) => {
      const removed = prev.find((task) => task.id === id);
      const next = prev.filter((task) => task.id !== id);
      if (removed && !next.some((task) => task.sessionId === removed.sessionId)) {
        setQueuePausedBySession((p) => {
          if (!p[removed.sessionId]) return p;
          const copy = { ...p };
          delete copy[removed.sessionId];
          return copy;
        });
      }
      return next;
    });
  };

  const clearQueue = () => {
    const sessionId = activeSessionId;
    setMessageQueue((prev) => prev.filter((task) => task.sessionId !== sessionId));
    setQueuePausedBySession((prev) => {
      if (!prev[sessionId]) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  };

  const resumeQueue = () => {
    setQueuePausedBySession((prev) => {
      if (!prev[activeSessionId]) return prev;
      const next = { ...prev };
      delete next[activeSessionId];
      return next;
    });
  };

  const jumpQueueAndSubmit = (id: string) => {
    const task = messageQueue.find((item) => item.id === id);
    if (!task) return;
    setMessageQueue((prev) => prev.filter((item) => item.id !== id));
    // Send Now — abort that session's current reply without freezing the rest.
    if (isSessionLoading(task.sessionId)) {
      stopGenerating({ pauseQueue: false, sessionId: task.sessionId });
    }
    setQueuePausedBySession((prev) => {
      if (!prev[task.sessionId]) return prev;
      const next = { ...prev };
      delete next[task.sessionId];
      return next;
    });
    setTimeout(() => {
      handleSubmit(task.content, task.baseMessages, true, task.sessionId);
    }, 50);
  };

  const runCompact = async (history: Message[]): Promise<Message[] | null> => {
    // Keep the newest turns verbatim; summarize everything before that.
    const keep = Math.min(6, history.length);
    if (history.length <= keep) return history;

    const older = history.slice(0, history.length - keep);
    const recent = history.slice(history.length - keep);

    setIsCompacting(true);
    setCompactNotice('Compacting earlier conversation…');
    try {
      const res = await fetch('/api/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: toApiMessages(older, { vision: selectedSpec.vision }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Compact failed');

      const compacted: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `[Compacted earlier conversation]\n\n${data.summary}`,
        timestamp: Date.now(),
        compacted: true,
      };
      setCompactNotice(`Compacted ${older.length} older messages`);
      setTimeout(() => setCompactNotice(''), 4000);
      return [compacted, ...recent];
    } catch (err: any) {
      setCompactNotice(err?.message || 'Compact failed');
      return null;
    } finally {
      setIsCompacting(false);
    }
  };

  const generateImage = async (
    prompt: string,
    opts?: {
      baseMessages?: Message[];
      skipDuplicateUser?: boolean;
      sessionId?: string;
      /** Caller already called beginLoading (e.g. queue drain). */
      alreadyLoading?: boolean;
    },
  ): Promise<boolean> => {
    const trimmed = prompt.trim();
    if (!trimmed) return false;
    if (!isAccountBound) {
      openLoginModal();
      return false;
    }
    const sessionId = opts?.sessionId || activeSessionId;
    if (isSessionLoading(sessionId) && !opts?.alreadyLoading) return false;

    stickToBottomRef.current = true;
    if (sessionId === activeSessionId) scrollToBottom(true);
    setIsSkillPickerOpen(false);
    if (sessionId === activeSessionId) setInput('');
    if (!opts?.alreadyLoading) beginLoading(sessionId);

    const sessionMessages =
      opts?.baseMessages ??
      sessionsRef.current.find((s) => s.id === sessionId)?.messages ??
      [];
    const cleanedBase = sessionMessages.filter(
      (m, idx, arr) => !(idx === arr.length - 1 && m.role === 'assistant' && m.incomplete && !m.content),
    );
    let newTitle = sessionsRef.current.find((s) => s.id === sessionId)?.title;
    if (cleanedBase.length === 0 || (cleanedBase.length === 1 && opts?.skipDuplicateUser)) {
      newTitle = trimmed.slice(0, 30) + (trimmed.length > 30 ? '...' : '');
    }

    const assistantId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: 'Generating image…',
      timestamp: Date.now(),
      incomplete: true,
    };

    const thread = opts?.skipDuplicateUser
      ? [...cleanedBase, assistantMessage]
      : [
          ...cleanedBase,
          {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content: `/image ${trimmed}`,
            timestamp: Date.now(),
          },
          assistantMessage,
        ];
    updateSession(sessionId, thread, newTitle);

    try {
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          model: 'gpt-image-1.5',
          size: '1024x1024',
          quality: 'medium',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Image generation failed');
      if (!data?.image) throw new Error('No image returned');

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    // Image alone is enough — don't echo the prompt under the picture.
                    content: '',
                    images: [
                      {
                        url: data.image as string,
                        name: 'generated.png',
                        prompt: trimmed,
                        model: 'GPT Image 1.5',
                        fileId: data.fileId ? String(data.fileId) : undefined,
                      },
                    ],
                    incomplete: false,
                  }
                : m,
            ),
            updatedAt: Date.now(),
          };
        }),
      );
      if (sessionId === activeSessionIdRef.current) {
        setPicturesExpanded(true);
        setIsContextPanelOpen(true);
      }
    } catch (error: any) {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `Error: ${error?.message || 'Image generation failed'}`,
                    incomplete: false,
                    images: undefined,
                  }
                : m,
            ),
            updatedAt: Date.now(),
          };
        }),
      );
    } finally {
      endLoading(sessionId);
    }
    return true;
  };

  const handleSubmit = async (
    overrideInput?: string,
    baseMessagesOverride?: Message[],
    force: boolean = false,
    targetSessionId?: string,
    opts?: { alreadyLoading?: boolean; resendAttachments?: IngestedAttachment[] },
  ): Promise<boolean> => {
    const sessionId = targetSessionId || activeSessionId;
    const textToSend = overrideInput || (sessionId === activeSessionId ? input : '');
    const imagePrompt = parseImageCommand(textToSend);
    if (imagePrompt) {
      if (!force && isSessionLoading(sessionId) && !opts?.alreadyLoading) return false;
      return generateImage(imagePrompt, {
        sessionId,
        alreadyLoading: opts?.alreadyLoading,
      });
    }

    const pendingImages = opts?.resendAttachments
      ? opts.resendAttachments.filter(
          (a) => isImageAttachment(a) && (a.dataUrl || a.fileId),
        )
      : sessionId === activeSessionId
        ? attachments.filter((a) => a.dataUrl || a.fileId)
        : [];
    const pendingTexts = opts?.resendAttachments
      ? opts.resendAttachments.filter((a) => a.text)
      : baseMessagesOverride
        ? []
        : sessionId === activeSessionId
          ? attachments.filter((a) => a.text)
          : [];
    if (
      (!textToSend.trim() && pendingImages.length === 0 && pendingTexts.length === 0) ||
      (!force && isSessionLoading(sessionId) && !opts?.alreadyLoading)
    ) {
      return false;
    }
    if (pendingImages.length > 0 && !selectedSpec.vision && !zhipuVisionOn) {
      if (sessionId === activeSessionId) setAttachError(t('imagesNeedVision'));
      return false;
    }
    const uploadChecks = opts?.resendAttachments ?? (sessionId === activeSessionId ? attachments : []);
    if (uploadChecks.some((a) => a.uploading)) {
      setAttachError('Wait for image upload to finish');
      return false;
    }
    if (uploadChecks.some((a) => a.uploadError)) {
      setAttachError('Remove or re-add images that failed to upload');
      return false;
    }
    if (sessionId === activeSessionId) {
      stickToBottomRef.current = true;
      scrollToBottom(true);
    }

    let fullContent = textToSend.trim();
    if (pendingTexts.length > 0) {
      const contextParts = pendingTexts.map(
        (a) => `[Attached File: ${a.name}]\n${a.text!.trim()}`,
      );
      fullContent = contextParts.join('\n\n') + (fullContent ? `\n\n---\n\n${fullContent}` : '');
    }

    const sessionMessages =
      baseMessagesOverride ??
      sessionsRef.current.find((s) => s.id === sessionId)?.messages ??
      [];
    const cleanedBase = sessionMessages.filter(
      (m, idx, arr) => !(idx === arr.length - 1 && m.role === 'assistant' && m.incomplete && !m.content),
    );

    let baseMessages = cleanedBase;
    let newTitle = sessionsRef.current.find((s) => s.id === sessionId)?.title;
    if (baseMessages.length === 0) {
      newTitle = (textToSend || pendingImages[0]?.name || 'New Conversation').slice(0, 30)
        + ((textToSend.length > 30) ? '...' : '');
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: fullContent || (pendingImages.length ? '(image)' : ''),
      timestamp: Date.now(),
      images: pendingImages.map((a) => ({
        url: a.fileId
          ? `/api/files/${encodeURIComponent(a.fileId)}`
          : a.dataUrl!,
        name: a.name,
        fileId: a.fileId,
      })),
    };

    const historySnapshot = sessionsRef.current.find((s) => s.id === sessionId);

    // Truncate the thread in the UI immediately (edit/resend), so Messages /
    // Context used / Material update before any await (compact / network).
    let newMessages = [...baseMessages, userMessage];
    updateSession(sessionId, newMessages, newTitle);
    if (sessionId === activeSessionId) {
      setInput('');
      attachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
      setAttachments([]);
    }

    // Lock the session before await compact so the queue cannot start a second stream.
    if (!opts?.alreadyLoading) beginLoading(sessionId);

    // Compact before sending when the thread is near the selected model's window.
    // usableLimit already follows selectedModel (context − output reserve).
    const estimateForSend = (history: Message[], nextUserText: string) => {
      // fullContent already embeds pending text files — do not also add files.
      // Reference must follow the truncated thread, not the pre-edit sidebar snapshot.
      const threadReference = estimateTokensFromText(
        formatWebSourcesForReference(
          sessionsRef.current.find((s) => s.id === sessionId)?.webSources || [],
        ),
      );
      const historyText = history.reduce(
        (sum, m) => sum + estimateTokensFromText(messagePlainText(m)) + 4,
        0,
      );
      const historyImages = history.reduce(
        (sum, m) => sum + (m.images?.length || 0) * 1000,
        0,
      );
      return (
        contextBreakdown.system +
        contextBreakdown.skills +
        threadReference +
        historyText +
        historyImages +
        pendingImages.length * 1000 +
        estimateTokensFromText(nextUserText)
      );
    };

    const restoreHistoryIfNeeded = () => {
      if (!historySnapshot || !baseMessagesOverride) return;
      updateSession(sessionId, historySnapshot.messages, historySnapshot.title);
    };

    if (usableLimit != null) {
      let projected = estimateForSend(baseMessages, fullContent);
      if (projected > usableLimit * 0.9) {
        const compacted = await runCompact(baseMessages);
        if (!compacted) {
          restoreHistoryIfNeeded();
          setAttachError('Context is full. Compact failed — open a new chat or remove attachments.');
          if (!opts?.alreadyLoading) endLoading(sessionId);
          return false;
        }
        baseMessages = compacted;
        newMessages = [...baseMessages, userMessage];
        updateSession(sessionId, newMessages, newTitle);
        projected = estimateForSend(baseMessages, fullContent);
        // Still over after compact (huge attachments / short thread): refuse rather than 413 upstream.
        if (projected > usableLimit) {
          restoreHistoryIfNeeded();
          setAttachError(
            `Context (~${projected.toLocaleString()}) exceeds this model's usable window (${usableLimit.toLocaleString()}). Remove attachments, compact, or switch to a larger-window model.`,
          );
          if (!opts?.alreadyLoading) endLoading(sessionId);
          return false;
        }
      }
    }

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      incomplete: true,
    };
    updateSession(sessionId, [...newMessages, assistantMessage], newTitle);

    const controller = new AbortController();
    abortControllersRef.current.set(sessionId, controller);
    const threadSources = sessionsRef.current.find((s) => s.id === sessionId)?.webSources || [];

    try {
      await streamChatResponse(
        sessionId,
        toApiMessages(newMessages, { vision: selectedSpec.vision }),
        assistantMessage.id,
        controller.signal,
        '',
        '',
        threadSources,
      );
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        // Keep any partial reply so the user can Continue; only use Error: when empty.
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const msgs = s.messages.map((m) => {
              if (m.id !== assistantMessage.id) return m;
              if (m.content.trim() || m.reasoning?.trim()) {
                return {
                  ...m,
                  incomplete: true,
                  truncationReason: error.message || 'Request failed',
                };
              }
              return {
                ...m,
                content: `Error: ${error.message || 'Request failed'}`,
                incomplete: false,
                truncationReason: undefined,
              };
            });
            return { ...s, messages: msgs, updatedAt: Date.now() };
          }),
        );
      } else {
        markAssistantIncomplete(sessionId, assistantMessage.id, true, {
          truncationReason: 'Reply was interrupted',
        });
      }
    } finally {
      endLoadingIfController(sessionId, controller);
    }
    return true;
  };

  const resumeIncompleteReply = async () => {
    const sessionId = activeSessionIdRef.current;
    const sessionMessages = sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
    const last = sessionMessages[sessionMessages.length - 1];
    if (isSessionLoading(sessionId) || !last || last.role !== 'assistant') return;

    const emptyInterrupted = last.incomplete && !last.content.trim();
    // Refuse to continue a reply that looks complete — matches the visible gate.
    if (!emptyInterrupted) {
      if (!last.content.trim()) return;
      const verdict = analyzeTruncation(
        last.content,
        last.finishReason,
        last.incomplete,
        last.truncationReason,
      );
      if (!verdict.truncated) return;
    }

    stickToBottomRef.current = true;
    scrollToBottom(true);
    beginLoading(sessionId);

    const controller = new AbortController();
    abortControllersRef.current.set(sessionId, controller);

    const lastUser = [...sessionMessages].reverse().find((m) => m.role === 'user');
    // Truly empty bubble (refresh mid-Process, no tokens at all): re-answer.
    // If Thought / tools already ran, keep them — wiping felt like “Continue deleted
    // my half reply” when GLM parked text in reasoning with empty content.
    const hasProcessOrThought = Boolean(
      last.reasoning?.trim() ||
        last.activity?.length ||
        last.toolRuns?.length,
    );
    if (emptyInterrupted && lastUser && !hasProcessOrThought) {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            updatedAt: Date.now(),
            messages: s.messages.map((m) =>
              m.id === last.id
                ? {
                    ...m,
                    content: '',
                    reasoning: undefined,
                    activity: undefined,
                    toolRuns: undefined,
                    incomplete: true,
                    truncationReason: undefined,
                    finishReason: undefined,
                  }
                : m,
            ),
          };
        }),
      );
      try {
        await streamChatResponse(
          sessionId,
          toApiMessages(
            sessionMessages.filter((m) => m.id !== last.id),
            { vision: selectedSpec.vision },
          ),
          last.id,
          controller.signal,
          '',
          '',
          sessionsRef.current.find((s) => s.id === sessionId)?.webSources || [],
        );
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              const msgs = s.messages.map((m) => {
                if (m.id !== last.id) return m;
                if (m.content.trim() || m.reasoning?.trim()) {
                  return {
                    ...m,
                    incomplete: true,
                    truncationReason: error.message || 'Request failed',
                  };
                }
                return {
                  ...m,
                  content: `Error: ${error.message || 'Request failed'}`,
                  incomplete: false,
                  truncationReason: undefined,
                };
              });
              return { ...s, messages: msgs, updatedAt: Date.now() };
            }),
          );
        } else {
          markAssistantIncomplete(sessionId, last.id, true, {
            truncationReason: 'Reply was interrupted',
          });
        }
      } finally {
        endLoadingIfController(sessionId, controller);
      }
      return;
    }

    // Empty content but Thought/tools already present: ask the model for the
    // visible answer without wiping Process history.
    if (emptyInterrupted && lastUser && hasProcessOrThought) {
      const apiMessages: ReturnType<typeof toApiMessages> = [
        ...toApiMessages(sessionMessages, { vision: selectedSpec.vision }),
        {
          role: 'user' as const,
          content: [
            'Your previous turn was interrupted before any user-visible answer text.',
            'Write the final answer now. Do not restart unrelated tasks.',
            'Do not claim you created/updated Notion pages or invent Notion URLs unless a tool result in this thread already returned that URL.',
          ].join(' '),
          images: [],
          timestamp: Date.now(),
        },
      ];
      try {
        await streamChatResponse(
          sessionId,
          apiMessages,
          last.id,
          controller.signal,
          '',
          '',
        );
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              const msgs = s.messages.map((m) => {
                if (m.id !== last.id) return m;
                if (m.content.trim() || m.reasoning?.trim()) {
                  return {
                    ...m,
                    incomplete: true,
                    truncationReason: error.message || 'Request failed',
                  };
                }
                return {
                  ...m,
                  content: `Error: ${error.message || 'Request failed'}`,
                  incomplete: false,
                  truncationReason: undefined,
                };
              });
              return { ...s, messages: msgs, updatedAt: Date.now() };
            }),
          );
        } else {
          markAssistantIncomplete(sessionId, last.id, true, {
            truncationReason: 'Reply was interrupted',
          });
        }
      } finally {
        endLoadingIfController(sessionId, controller);
      }
      return;
    }

    const polluted =
      Boolean(lastUser) &&
      assistantMismatchesUserTopic(lastUser!.content, last.content);

    // Cross-chat bleed (e.g. formula chat Continue resumes a Python agent task):
    // steer with a corrective prompt, but never wipe the partial bubble.
    let apiMessages: ReturnType<typeof toApiMessages>;
    let initialContent = last.content;
    let seamPrefix = '';

    if (polluted && lastUser) {
      // Keep the partial bubble — wiping mid-reply felt like Continue "deleted"
      // half the answer. Only steer the model with a corrective user turn.
      apiMessages = [
        ...toApiMessages(sessionMessages, {
          vision: selectedSpec.vision,
        }),
        {
          role: 'user' as const,
          content: [
            'Continue THIS conversation only from where the assistant reply stopped.',
            'Do not restart the answer, and do not continue any other chat\'s tasks, workspace scans, refactors, or tool plans.',
            'Do not mention filesystems, shell, or scanning a workspace unless the user asked for that.',
            buildContinuationPrompt(last.content),
          ].join('\n\n'),
          images: [],
          timestamp: Date.now(),
        },
      ];
      initialContent = last.content;
      const tail = last.content.trimEnd();
      const lastLine = tail.split('\n').pop() ?? '';
      seamPrefix = /^\s*\|.*\|\s*$/.test(lastLine) ? '\n' : '';
    } else {
      apiMessages = [
        ...toApiMessages(sessionMessages, { vision: selectedSpec.vision }),
        {
          role: 'user' as const,
          content: buildContinuationPrompt(last.content),
          images: [],
          timestamp: Date.now(),
        },
      ];
      const tail = last.content.trimEnd();
      const lastLine = tail.split('\n').pop() ?? '';
      seamPrefix = /^\s*\|.*\|\s*$/.test(lastLine) ? '\n' : '';
    }

    try {
      await streamChatResponse(
        sessionId,
        apiMessages,
        last.id,
        controller.signal,
        initialContent,
        seamPrefix,
      );
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        // Keep partial resumed text; fall back to Error only if somehow empty.
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const msgs = s.messages.map((m) => {
              if (m.id !== last.id) return m;
              if (m.content.trim()) {
                return {
                  ...m,
                  incomplete: true,
                  truncationReason: error.message || 'Request failed',
                };
              }
              return {
                ...m,
                content: `Error: ${error.message || 'Request failed'}`,
                incomplete: false,
              };
            });
            return { ...s, messages: msgs, updatedAt: Date.now() };
          }),
        );
      } else {
        markAssistantIncomplete(sessionId, last.id, true, {
          truncationReason: 'Stopped by you',
        });
      }
    } finally {
      endLoadingIfController(sessionId, controller);
    }
  };

  /** Drop the Error: assistant bubble and re-run the same user turn. */
  const retryFailedReply = async () => {
    const sessionId = activeSessionIdRef.current;
    const sessionMessages = sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
    const last = sessionMessages[sessionMessages.length - 1];
    if (isSessionLoading(sessionId) || !isAssistantError(last)) return;
    const prior = sessionMessages.slice(0, -1);
    const lastUser = [...prior].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;

    const imagePrompt = parseImageCommand(lastUser.content);
    if (imagePrompt) {
      await generateImage(imagePrompt, {
        baseMessages: prior,
        skipDuplicateUser: true,
        sessionId,
      });
      return;
    }

    stickToBottomRef.current = true;
    scrollToBottom(true);
    beginLoading(sessionId);

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      incomplete: true,
    };
    updateSession(sessionId, [...prior, assistantMessage]);

    const controller = new AbortController();
    abortControllersRef.current.set(sessionId, controller);
    try {
      await streamChatResponse(
        sessionId,
        toApiMessages(prior, { vision: selectedSpec.vision }),
        assistantMessage.id,
        controller.signal,
      );
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        updateSession(sessionId, [
          ...prior,
          {
            id: assistantMessage.id,
            role: 'assistant',
            content: `Error: ${error.message || 'Request failed'}`,
            timestamp: Date.now(),
            incomplete: false,
          },
        ]);
      } else {
        markAssistantIncomplete(sessionId, assistantMessage.id, true, {
          truncationReason: 'Reply was interrupted',
        });
      }
    } finally {
      endLoadingIfController(sessionId, controller);
    }
  };

  const editUserMessage = (messageId: string) => {
    if (isActiveLoading) return;
    const sessionId = activeSessionIdRef.current;
    const sessionMsgs =
      sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
    const message = sessionMsgs.find((m) => m.id === messageId);
    if (!message || message.role !== 'user') return;
    setEditingMessageId(message.id);
    setEditingMessageContent(
      message.content && message.content !== '(image)'
        ? stripUserMessageArtifactsForDisplay(message.content)
        : '',
    );
    setEditingMessageAttachments(messageImagesToIngested(message.images));
  };

  const cancelEditMessage = () => {
    editingMessageAttachments.forEach((a) => {
      if (a.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl);
    });
    setEditingMessageId(null);
    setEditingMessageContent('');
    setEditingMessageAttachments([]);
  };

  const saveEditedMessage = async (messageId: string) => {
    const content = editingMessageContent.trim();
    const resendImages = ingestedToMessageImages(
      editingMessageAttachments.filter((a) => isImageAttachment(a)),
    );
    const hasTextFiles = editingMessageAttachments.some((a) => a.text);
    if ((!content && resendImages.length === 0 && !hasTextFiles) || isActiveLoading) return;
    if (editingMessageAttachments.some((a) => a.uploading)) {
      setAttachError('Wait for image upload to finish');
      return;
    }
    if (editingMessageAttachments.some((a) => a.uploadError)) {
      setAttachError('Remove or re-add images that failed to upload');
      return;
    }
    if (resendImages.length > 0 && !selectedSpec.vision && !zhipuVisionOn) {
      setAttachError(t('imagesNeedVision'));
      return;
    }
    const sessionId = activeSessionId;
    const sessionMsgs =
      sessionsRef.current.find((s) => s.id === sessionId)?.messages || messages;
    const index = sessionMsgs.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const priorMessages = sessionMsgs.slice(0, index);
    const textToSend = content || (resendImages.length ? '(image)' : '');
    const resendAttachments = [...editingMessageAttachments];
    editingMessageAttachments.forEach((a) => {
      if (a.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl);
    });
    setEditingMessageId(null);
    setEditingMessageContent('');
    setEditingMessageAttachments([]);

    if (isActiveLoading) {
      stopGenerating();
      setTimeout(() => {
        void handleSubmit(textToSend, priorMessages, false, sessionId, { resendAttachments });
      }, 50);
    } else {
      await handleSubmit(textToSend, priorMessages, false, sessionId, { resendAttachments });
    }
  };

  const exportChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    const md = session.messages.map(m => `### ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.content}\n`).join('\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setSessionMenuOpenId(null);
  };

  const isEnterSubmitBlockedByIme = (
    e: React.KeyboardEvent,
    composingRef: React.MutableRefObject<boolean>,
    enterLockRef: React.MutableRefObject<boolean>,
  ) =>
    e.nativeEvent.isComposing ||
    composingRef.current ||
    enterLockRef.current ||
    e.keyCode === 229;

  const bindImeGuards = (
    composingRef: React.MutableRefObject<boolean>,
    enterLockRef: React.MutableRefObject<boolean>,
  ) => ({
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
      enterLockRef.current = true;
      window.setTimeout(() => {
        enterLockRef.current = false;
      }, 30);
    },
  });

  const stopGenerating = (opts?: { pauseQueue?: boolean; sessionId?: string }) => {
    const pauseQueue = opts?.pauseQueue ?? true;
    const sessionId = opts?.sessionId || activeSessionIdRef.current;
    const controller = abortControllersRef.current.get(sessionId);
    if (controller) {
      controller.abort();
      endLoading(sessionId);
    }
    // Keep the half-written assistant reply resumable after stop/refresh.
    const sessionMsgs = sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
    const last = sessionMsgs[sessionMsgs.length - 1];
    if (last?.role === 'assistant') {
      markAssistantIncomplete(sessionId, last.id, true, {
        truncationReason: 'Stopped by you',
      });
    }
    // Stopping mid-reply should freeze remaining queued messages for this session.
    if (pauseQueue) {
      setQueuePausedBySession((prev) => ({ ...prev, [sessionId]: true }));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashMenuItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashHighlight((i) => (i + 1) % slashMenuItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashHighlight((i) => (i - 1 + slashMenuItems.length) % slashMenuItems.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        if (isEnterSubmitBlockedByIme(e, composerImeComposingRef, composerImeEnterLockRef)) {
          return;
        }
        e.preventDefault();
        const pick = slashMenuItems[slashHighlight] || slashMenuItems[0];
        if (pick) consumeSlashItem(pick);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // Dismiss the menu without wiping the typed command.
        setInput((prev) =>
          prev.replace(/(?:^|\n)\/([^\n]*)$/, (seg, body: string) => {
            const prefix = seg.startsWith('\n') ? '\n' : '';
            return `${prefix}/${body}${body.endsWith(' ') ? '' : ' '}`;
          }),
        );
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const pick = slashMenuItems[slashHighlight] || slashMenuItems[0];
        if (pick) consumeSlashItem(pick);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (isEnterSubmitBlockedByIme(e, composerImeComposingRef, composerImeEnterLockRef)) {
        return;
      }
      e.preventDefault();
      // Prevent holding down Enter to spawn dozens of identical tasks
      if (e.repeat) return;
      enqueueOrSubmit();
    }
  };

  const handleEditMessageKeyDown = (e: React.KeyboardEvent, messageId: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isEnterSubmitBlockedByIme(e, editImeComposingRef, editImeEnterLockRef)) {
        return;
      }
      e.preventDefault();
      if (e.repeat) return;
      void saveEditedMessage(messageId);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditMessage();
    }
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) setIsDraggingFiles(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (e.dataTransfer.files?.length) {
      await addIngestedFiles(e.dataTransfer.files);
    }
  };
  const onPasteFiles = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    await addIngestedFiles(files);
  };

  const onPasteEditFiles = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    await addEditIngestedFiles(files);
  };

  return (
    <div
      className="relative flex h-screen w-full bg-[#F9F8F6] font-sans text-stone-800 dark:bg-stone-950 dark:text-stone-200 overflow-hidden"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDropFiles}
    >
      {isDraggingFiles && (
        <div className="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center bg-orange-500/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-orange-400 bg-white/90 px-8 py-6 text-center shadow-lg dark:bg-stone-900/90">
            <div className="text-sm font-semibold text-orange-700 dark:text-orange-300">Drop to attach</div>
            <div className="mt-1 text-xs text-stone-500">Images, PDF, Word, or text files</div>
          </div>
        </div>
      )}
      
      {/* --- Sidebar --- */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="h-full shrink-0 border-r border-stone-200 bg-stone-100/60 dark:border-stone-800 dark:bg-stone-900/60 flex flex-col"
          >
            <div className="p-4 flex flex-col gap-3 border-b border-stone-200/50 dark:border-stone-800/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 font-semibold text-[15px] tracking-tight text-stone-900 dark:text-stone-100">
                  <BrandMark className="h-7 w-7 shadow-sm" />
                  Christmas Chat
                </div>
              </div>

              <Button 
                onClick={createNewSession}
                className="w-full justify-start gap-2 bg-white text-stone-700 hover:bg-stone-50 border border-stone-200 shadow-sm dark:bg-stone-800 dark:text-stone-200 dark:border-stone-700 dark:hover:bg-stone-700"
              >
                <Plus className="h-4 w-4" />
                {t('newChat')}
              </Button>

              {/* Skills entry under New Chat (ChatGPT-style tools area) */}
              <div className="space-y-1 pt-1">
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isAccountBound) {
                        openLoginModal();
                        return;
                      }
                      setSkillsExpanded((v) => !v);
                      setMcpExpanded(false);
                      if (skills.length === 0) fetchSkills();
                    }}
                    className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50 transition-colors"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <ScrollText className="h-4 w-4 text-stone-500" />
                      {t('skills')}
                    </span>
                    <ChevronDown className={cn('h-3.5 w-3.5 text-stone-400 transition-transform', skillsExpanded && isAccountBound ? 'rotate-180' : '')} />
                  </button>

                  <AnimatePresence initial={false}>
                    {isAccountBound && skillsExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden pl-2"
                      >
                        <div className="space-y-0.5 pb-1">
                          <button
                            type="button"
                            onClick={openNewSkillModal}
                            className="mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs font-medium text-stone-500 hover:bg-stone-200/50 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800/50 dark:hover:text-stone-200"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {t('newSkill')}
                          </button>
                          {skills.length === 0 ? null : (
                            skills.map((skill) => (
                              <div
                                key={skill.id}
                                className="group flex items-center rounded-lg hover:bg-stone-200/60 dark:hover:bg-stone-800/60"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    toggleSkill(skill.id);
                                  }}
                                  className={cn(
                                    'flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                                    activeSkillIds.includes(skill.id)
                                      ? 'text-stone-900 dark:text-stone-100'
                                      : 'text-stone-600 dark:text-stone-300',
                                  )}
                                  title={
                                    activeSkillIds.includes(skill.id)
                                      ? `已启用 /${skillSlashName(skill.title)} — 再点取消`
                                      : `启用 Skill · /${skillSlashName(skill.title)}`
                                  }
                                >
                                  <ScrollText className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                                  <span className="truncate">{skill.title}</span>
                                  {activeSkillIds.includes(skill.id) && (
                                    <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-stone-500" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => requestDeleteSkill(skill.id, e)}
                                  className="mr-1 rounded p-1 text-stone-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-900/20"
                                  title="Delete skill"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* MCP — same collapsible pattern as Skills; click Notion for connect/disconnect card */}
                <div>
                <button
                  type="button"
                  onClick={() => {
                    if (!isAccountBound) {
                      openLoginModal();
                      return;
                    }
                    setMcpExpanded((v) => !v);
                    setSkillsExpanded(false);
                    void fetchIntegrations();
                  }}
                  className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Blocks className="h-4 w-4 text-stone-500" />
                    {t('mcpTools')}
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-stone-400 transition-transform',
                      mcpExpanded && isAccountBound ? 'rotate-180' : '',
                    )}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {isAccountBound && mcpExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden pl-2"
                    >
                      <div className="space-y-0.5 pb-1">
                        <div
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-stone-400 dark:text-stone-500"
                          title={
                            selectedSpec.vision
                              ? t('imageUnderstandDisabledOnVision')
                              : t('zhipuVisionMcpHint')
                          }
                          aria-disabled
                        >
                          <ImageIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{t('enableZhipuVisionMcp')}</div>
                            <div className="truncate text-[10px] opacity-80">
                              {selectedSpec.vision
                                ? t('imageUnderstandDisabledOnVision')
                                : t('imageUnderstandBuiltIn')}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openNotionModal()}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                        >
                          <NotionLogo className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">Notion</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openGitHubModal()}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                        >
                          <GitHubLogo className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">GitHub</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openGoogleModal()}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/50"
                        >
                          <GoogleLogo className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">Google</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1 px-3 py-2">
              <div className="space-y-3">
                {sidebarDayGroups.map((group) => {
                  const open = group.isToday || Boolean(pastDayOpen[group.key]);
                  const label = formatDayGroupLabel(group.key);
                  return (
                    <div key={group.key} className="space-y-1">
                      {group.isToday ? (
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                          {label}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setPastDayOpen((prev) => ({
                              ...prev,
                              [group.key]: !prev[group.key],
                            }))
                          }
                          className="flex w-full items-center gap-1 rounded-lg px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-stone-400 hover:bg-stone-200/40 hover:text-stone-600 dark:hover:bg-stone-800/40 dark:hover:text-stone-300"
                        >
                          <ChevronDown
                            className={cn(
                              'h-3 w-3 shrink-0 opacity-60 transition-transform',
                              open ? 'rotate-0' : '-rotate-90',
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          <span className="opacity-50">{group.sessions.length}</span>
                        </button>
                      )}
                      {open &&
                        group.sessions.map((session) => (
                          <div key={session.id} className="relative group">
                            <div
                              onClick={() => {
                                setActiveSessionId(session.id);
                                setWebSourcesCleared(false);
                                setQuotedSelections([]);
                                setSessionMenuOpenId(null);
                              }}
                              className={cn(
                                'flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
                                activeSessionId === session.id
                                  ? 'bg-white text-stone-900 shadow-sm border border-stone-200 dark:bg-stone-800 dark:text-stone-100 dark:border-stone-700'
                                  : 'text-stone-600 hover:bg-stone-200/50 dark:text-stone-400 dark:hover:bg-stone-800/50',
                              )}
                            >
                              <div className="flex w-full items-center gap-2 overflow-hidden pr-6">
                                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                                {isSessionLoading(session.id) && (
                                  <Loader2
                                    className="h-3.5 w-3.5 shrink-0 animate-spin text-orange-500"
                                    aria-label={t('generating')}
                                  />
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              data-session-menu-trigger={session.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSessionMenuOpenId(
                                  sessionMenuOpenId === session.id ? null : session.id,
                                );
                              }}
                              className={cn(
                                'absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md bg-transparent hover:bg-stone-200 dark:hover:bg-stone-700 transition-opacity',
                                sessionMenuOpenId === session.id
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover:opacity-100',
                              )}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5 text-stone-500" />
                            </button>

                            <AnimatePresence>
                              {sessionMenuOpenId === session.id && (
                                <motion.div
                                  data-session-menu={session.id}
                                  initial={{ opacity: 0, scale: 0.95 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.95 }}
                                  className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl dark:border-stone-700 dark:bg-stone-900"
                                >
                                  <div className="px-2 py-1.5 border-b border-stone-100 dark:border-stone-800/50 mb-1 flex items-center gap-2 text-xs text-stone-400">
                                    <Clock className="h-3 w-3" />
                                    {new Date(session.updatedAt).toLocaleString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: 'numeric',
                                      minute: '2-digit',
                                    })}
                                  </div>

                                  <div className="px-2 py-1 text-xs text-stone-500">
                                    {session.messages.length} messages
                                  </div>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      exportChat(session.id, e);
                                      setSessionMenuOpenId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100 rounded-md dark:text-stone-300 dark:hover:bg-stone-800"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                    {t('exportMarkdown')}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSessionMenuOpenId(null);
                                      setSessionPendingDelete({
                                        id: session.id,
                                        title: session.title,
                                      });
                                    }}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md dark:text-red-400 dark:hover:bg-red-900/20"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    {t('deleteChat')}
                                  </button>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
              
              {/* Sidebar Footer: Account / Language / Theme */}
              <div className="relative p-3 border-t border-stone-200/60 dark:border-stone-800/60 bg-stone-100/80 dark:bg-stone-900/80" ref={accountMenuRef}>
                <AnimatePresence>
                  {isAccountMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      className="absolute bottom-full left-3 right-3 mb-2 z-50 overflow-hidden rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl dark:border-stone-700 dark:bg-stone-900"
                    >
                      <div className="px-2.5 py-2 border-b border-stone-100 dark:border-stone-800 mb-1">
                        <div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                          {accountDisplayName}
                        </div>
                        <div className="truncate text-[11px] text-stone-400">
                          {isAccountBound ? t('accountConnectedHint') : t('connectAccountHint')}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                      >
                        <Globe className="h-3.5 w-3.5 text-stone-400" />
                        <span className="flex-1 text-left">{t('language')}</span>
                        <span className="text-xs text-stone-400">
                          {locale === 'zh' ? t('languageZh') : t('languageEn')}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleTheme()}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                      >
                        {preference === 'system' ? (
                          <Monitor className="h-3.5 w-3.5 text-stone-400" />
                        ) : theme === 'dark' ? (
                          <Sun className="h-3.5 w-3.5 text-stone-400" />
                        ) : (
                          <Moon className="h-3.5 w-3.5 text-stone-400" />
                        )}
                        <span className="flex-1 text-left">{t('theme')}</span>
                        <span className="text-xs text-stone-400">
                          {preference === 'system'
                            ? t('themeSystem')
                            : preference === 'dark'
                              ? t('themeDark')
                              : t('themeLight')}
                        </span>
                      </button>

                      <div className="my-1 border-t border-stone-100 dark:border-stone-800" />

                      {isAccountBound ? (
                        <button
                          type="button"
                          onClick={() => {
                            setIsAccountMenuOpen(false);
                            void disconnectAccount();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          {t('signOut')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setIsAccountMenuOpen(false);
                            openLoginModal();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                        >
                          <Key className="h-3.5 w-3.5" />
                          {t('connect')}
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="button"
                  onClick={() => setIsAccountMenuOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white p-2.5 text-left transition-colors hover:bg-stone-50 hover:border-stone-300 focus-visible:ring-2 focus-visible:ring-stone-300 dark:border-stone-700 dark:bg-stone-800 dark:hover:bg-stone-700/80 dark:hover:border-stone-600 dark:focus-visible:ring-stone-600"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div
                      className={cn(
                        'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-stone-100 text-stone-700',
                        'border-stone-200 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200',
                      )}
                    >
                      <Key className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-stone-800 dark:text-stone-100">
                        {accountDisplayName}
                      </div>
                      <div className="truncate text-[10px] text-stone-400">
                        {isAccountBound ? t('accountConnectedHint') : t('connectAccountHint')}
                      </div>
                    </div>
                  </div>
                  <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform', isAccountMenuOpen && 'rotate-180')} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Main Area --- */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#F9F8F6] dark:bg-stone-950 h-full overflow-hidden">
        
        {/* Minimal Header */}
        <header className="flex h-14 items-center justify-between px-4 border-b border-stone-200/50 dark:border-stone-800/50 bg-[#F9F8F6] dark:bg-stone-950 z-10 shrink-0">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(true)} className="text-stone-500 hover:bg-stone-200/50 dark:hover:bg-stone-800/50">
                <Menu className="h-5 w-5" />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setIsContextPanelOpen(!isContextPanelOpen)}
              className={cn("text-xs gap-1.5", isContextPanelOpen ? "bg-stone-200/50 dark:bg-stone-800 text-stone-900 dark:text-stone-100" : "text-stone-500")}
            >
              {isContextPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              {t('context')}
            </Button>
          </div>
        </header>

        {/* Messages and Context Split */}
        <div className="flex-1 flex min-h-0 overflow-hidden relative">
          
          {/* Messages Area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Messages List */}
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              ref={scrollRef}
              onScroll={handleMessagesScroll}
            >
          <div ref={messagesContentRef} className="mx-auto w-full max-w-[960px] px-5 py-8 md:px-8 lg:px-10">
            {messages.length === 0 ? (
              <div className="mt-16 flex flex-col items-center text-center">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm">
                  <BrandMark className="h-14 w-14" />
                </div>
                <h2 className="mb-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
                  {t('heroTitle')}
                </h2>
                <p className="text-stone-500 max-w-md text-sm">
                  {t('heroSubtitle')}
                </p>

                <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 w-full max-w-2xl mx-auto">
                  {[
                    t('starter1'),
                    t('starter2'),
                    t('starter3'),
                    t('starter4'),
                  ].map(hint => (
                    <button 
                      key={hint}
                      onClick={() => handleSubmit(hint)}
                      className="rounded-xl border border-stone-200/80 bg-white p-4 text-left text-sm text-stone-700 transition-all hover:border-stone-400 hover:shadow-md dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600"
                    >
                      <div className="font-medium">{hint}</div>
                      <div className="mt-1 text-xs text-stone-400">{t('clickToAsk')}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-8 pb-20">
                {messages.map((message) =>
                  message.compacted ? (
                    <div
                      key={message.id}
                      className="flex w-full items-center gap-3 py-1.5 text-amber-700 dark:text-amber-300"
                      title={t('compactedTooltip')}
                    >
                      <div className="h-px flex-1 bg-amber-200/80 dark:bg-amber-900/60" />
                      <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider dark:border-amber-900/60 dark:bg-amber-950/40">
                        <Sparkles className="h-3 w-3" />
                        {t('compacted')}
                      </div>
                      <div className="h-px flex-1 bg-amber-200/80 dark:bg-amber-900/60" />
                    </div>
                  ) : message.role === 'user' ? (
                    <div
                      id={`message-${message.id}`}
                      key={message.id}
                      className="group flex w-full scroll-mt-8 justify-end transition-colors"
                    >
                      <div className="max-w-[82%] sm:max-w-[72%]">
                        {editingMessageId === message.id ? (
                          <div
                            className="rounded-2xl border border-stone-300 bg-white p-3 shadow-sm dark:border-stone-700 dark:bg-stone-900 w-full min-w-[min(100%,20rem)]"
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (e.dataTransfer.files?.length) {
                                void addEditIngestedFiles(e.dataTransfer.files);
                              }
                            }}
                          >
                            {editingMessageAttachments.length > 0 && (
                              <div className="mb-2 flex flex-wrap gap-2">
                                {editingMessageAttachments.map((a) =>
                                  isImageAttachment(a) ? (
                                    <AttachmentImageThumb
                                      key={a.id}
                                      attachment={a}
                                      variant="free"
                                      onPreview={setImagePreviewSrc}
                                      onRemove={() => removeEditingMessageAttachment(a.id)}
                                    />
                                  ) : (
                                    <div
                                      key={a.id}
                                      className="group flex max-w-full items-center gap-2 rounded-xl border border-stone-200 bg-white px-2 py-1.5 text-xs shadow-sm dark:border-stone-700 dark:bg-stone-900"
                                    >
                                      <FileText className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                                      <span className="truncate text-stone-600 dark:text-stone-300">
                                        {a.name}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => removeEditingMessageAttachment(a.id)}
                                        className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-red-500 dark:hover:bg-stone-800"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
                            <Textarea
                              value={editingMessageContent}
                              onChange={(event) => setEditingMessageContent(event.target.value)}
                              onKeyDown={(e) => handleEditMessageKeyDown(e, message.id)}
                              onPaste={onPasteEditFiles}
                              placeholder={t('writeMessage', {
                                model: selectedModel || 'AI',
                              })}
                              {...bindImeGuards(editImeComposingRef, editImeEnterLockRef)}
                              className="min-h-[40px] max-h-[400px] w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-7 focus-visible:ring-0"
                              style={{ height: 'auto' }}
                              onInput={(e) => {
                                const target = e.target as HTMLTextAreaElement;
                                target.style.height = 'auto';
                                target.style.height = Math.min(target.scrollHeight, 400) + 'px';
                              }}
                              autoFocus
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={cancelEditMessage}
                                className="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => saveEditedMessage(message.id)}
                                disabled={
                                  editingMessageAttachments.some((a) => a.uploading) ||
                                  (!editingMessageContent.trim() &&
                                    !editingMessageAttachments.some(
                                      (a) =>
                                        a.text ||
                                        (isImageAttachment(a) && (a.dataUrl || a.fileId)),
                                    ))
                                }
                                className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                              >
                                Save & resend
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {(() => {
                              const { quotes, body } = parseQuotedUserMessage(
                                message.content && message.content !== '(image)'
                                  ? stripUserMessageArtifactsForDisplay(message.content)
                                  : '',
                              );
                              return (
                                <div className="overflow-hidden rounded-2xl rounded-br-md bg-stone-200/80 text-[15px] leading-7 text-stone-900 dark:bg-stone-800 dark:text-stone-100">
                                  {quotes.length > 0 ? (
                                    <div className="mx-3.5 mt-2.5 mb-0 space-y-1">
                                      {quotes.map((quote, qi) => (
                                        <blockquote
                                          key={qi}
                                          className="border-l-2 border-stone-400/70 py-0 pl-2.5 dark:border-stone-500"
                                        >
                                          <div className="chat-markdown chat-quote text-[12px] leading-4 text-stone-500 dark:text-stone-400 [&_p]:mb-0 [&_p]:leading-4">
                                            <ReactMarkdown
                                              remarkPlugins={[remarkMath, remarkGfm]}
                                              rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
                                              components={{
                                                p({ children }: any) {
                                                  return (
                                                    <p className="whitespace-pre-wrap">{children}</p>
                                                  );
                                                },
                                                code({ children }: any) {
                                                  return (
                                                    <code className="rounded bg-stone-300/50 px-1 py-0.5 font-mono text-[11px] dark:bg-stone-700/60">
                                                      {children}
                                                    </code>
                                                  );
                                                },
                                              }}
                                            >
                                              {prepareChatMarkdown(compactQuoteMath(quote))}
                                            </ReactMarkdown>
                                          </div>
                                        </blockquote>
                                      ))}
                                    </div>
                                  ) : null}
                                  {(body || (message.images && message.images.length > 0)) && (
                                  <div className={cn('px-4 py-2.5 whitespace-pre-wrap', quotes.length > 0 && 'pt-1.5')}>
                                    {message.images && message.images.length > 0 && (
                                      <div className={cn('flex flex-wrap gap-2', body && 'mb-2')}>
                                        {message.images.map((img, idx) => (
                                          <button
                                            key={idx}
                                            type="button"
                                            onClick={() => setImagePreviewSrc(img.url)}
                                            className="cursor-zoom-in overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60"
                                          >
                                            <img
                                              src={img.url}
                                              alt={img.name || 'attachment'}
                                              className="max-h-48 max-w-full rounded-lg object-contain"
                                            />
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    {body || null}
                                  </div>
                                  )}
                                </div>
                              );
                            })()}
                            <div className="mt-1 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => editUserMessage(message.id)}
                                className="rounded-md px-2 py-1 text-[11px] text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
                              >
                                Edit
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div key={message.id} className="w-full pr-8 sm:pr-16 space-y-3">
                      {(() => {
                        const parts = displayAssistantParts(message);
                        const visibleContent = parts.content;
                        const visibleReasoning = parts.reasoning;
                        const toolById = new Map(
                          (message.toolRuns || []).map((run) => [run.id, run]),
                        );
                        // Prefer live activity timeline; fall back for older saved messages.
                        const activitySteps = (() => {
                          const base =
                            message.activity && message.activity.length > 0
                              ? [...message.activity]
                              : [
                                  ...(visibleReasoning
                                    ? [
                                        {
                                          id: `${message.id}-reasoning`,
                                          kind: 'reasoning' as const,
                                          text: visibleReasoning,
                                        },
                                      ]
                                    : []),
                                  ...(message.toolRuns || []).map((run) => ({
                                    id: `${message.id}-tool-${run.id}`,
                                    kind: 'tool' as const,
                                    toolRunId: run.id,
                                  })),
                                ];
                          const seen = new Set(
                            base
                              .filter((s): s is { id: string; kind: 'tool'; toolRunId: string } =>
                                s.kind === 'tool',
                              )
                              .map((s) => s.toolRunId),
                          );
                          for (const run of message.toolRuns || []) {
                            if (!seen.has(run.id)) {
                              base.push({
                                id: `${message.id}-tool-orphan-${run.id}`,
                                kind: 'tool',
                                toolRunId: run.id,
                              });
                            }
                          }
                          return base;
                        })();
                        type ActivityStep = (typeof activitySteps)[number];
                        type ToolStep = Extract<ActivityStep, { kind: 'tool' }>;
                        type ProcessStep = Exclude<ActivityStep, { kind: 'content' }>;

                        const hasContentSteps = activitySteps.some((s) => s.kind === 'content');
                        // Spinner only while THIS turn is actively streaming. After a
                        // refresh, incomplete stays true but loading is false — without
                        // this gate Process would spin forever.
                        const messageIsStreaming =
                          isActiveLoading && message.id === lastMessage?.id;
                        const awaitingFirstContent = Boolean(
                          message.incomplete && !visibleContent && messageIsStreaming,
                        );
                        const replyWait = Boolean(
                          messageIsStreaming &&
                            message.incomplete &&
                            replyWaitByMessage[message.id],
                        );

                        /** Group consecutive reasoning/tool steps into Process panels, split by content. */
                        type TimelineSegment =
                          | { type: 'process'; id: string; steps: ProcessStep[]; live: boolean }
                          | { type: 'content'; id: string; text: string };

                        const timelineSegments: TimelineSegment[] = (() => {
                          if (!hasContentSteps) {
                            const processSteps = activitySteps.filter(
                              (s): s is ProcessStep => s.kind !== 'content',
                            );
                            const segs: TimelineSegment[] = [];
                            if (awaitingFirstContent || processSteps.length > 0 || replyWait) {
                              segs.push({
                                type: 'process',
                                id: `${message.id}-process-0`,
                                steps: processSteps,
                                live: awaitingFirstContent || replyWait,
                              });
                            }
                            if (visibleContent.trim()) {
                              segs.push({
                                type: 'content',
                                id: `${message.id}-content-legacy`,
                                text: visibleContent,
                              });
                            }
                            return segs;
                          }
                          const segs: TimelineSegment[] = [];
                          let buf: ProcessStep[] = [];
                          let processIdx = 0;
                          const flushProcess = (live: boolean) => {
                            if (!buf.length && !live) return;
                            segs.push({
                              type: 'process',
                              id: `${message.id}-process-${processIdx++}`,
                              steps: buf,
                              live,
                            });
                            buf = [];
                          };
                          for (const step of activitySteps) {
                            if (step.kind === 'content') {
                              flushProcess(false);
                              if (step.text.trim()) {
                                segs.push({ type: 'content', id: step.id, text: step.text });
                              }
                            } else {
                              buf.push(step);
                            }
                          }
                          // Trailing Process: in-flight tools/thought, or idle gap waiting
                          // for the next token after narration ("正在写入……" → tool).
                          flushProcess(
                            Boolean(
                              messageIsStreaming &&
                                (buf.length > 0 || !visibleContent || replyWait),
                            ),
                          );
                          // Live empty Process while waiting before any activity.
                          if (
                            messageIsStreaming &&
                            segs.length === 0
                          ) {
                            segs.push({
                              type: 'process',
                              id: `${message.id}-process-live`,
                              steps: [],
                              live: true,
                            });
                          }
                          return segs;
                        })();
                        const renderToolStep = (step: ToolStep) => {
                          const run = toolById.get(step.toolRunId);
                          if (!run) return null;
                          const isNotion =
                            run.name.startsWith('notion_') ||
                            run.name.startsWith('notion-') ||
                            run.provider === 'notion';
                          const isGitHub =
                            run.provider === 'github' ||
                            /^github[-_]/i.test(run.name);
                          const isGoogle =
                            run.provider === 'google' ||
                            /^(gmail|calendar|drive)[-_]/i.test(run.name);
                          const isGmail = isGoogle && /^gmail[-_]/i.test(run.name);
                          const isCalendar =
                            isGoogle && /^calendar[-_]/i.test(run.name);
                          const isDrive = isGoogle && /^drive[-_]/i.test(run.name);
                          const isNotionFetch =
                            /fetch/i.test(run.name) && isNotion;
                          const isNotionWrite =
                            isNotion &&
                            /create|update|move|duplicate|append|delete|trash|comment|write/i.test(
                              run.name,
                            );
                          const isGoogleWrite =
                            isGoogle &&
                            /create|update|send|reply|forward|delete|draft|modify|trash|batch|move|copy|share|revoke|upload|export|comment|acl|insert|write/i.test(
                              run.name,
                            );
                          const isWebRead =
                            run.name === 'web_read' || run.name === 'web-read';
                          const isImageUnderstand =
                            run.name === 'image_understand' ||
                            run.provider === 'zhipu-vision';
                          const failed = run.status === 'done' && Boolean(run.error);
                          const emptyResults =
                            run.status === 'done' &&
                            !run.error &&
                            (!run.results || run.results.length === 0);
                          // Only spin while this session is actually streaming —
                          // orphan status:"start" after refresh must not look live.
                          const searching =
                            run.status === 'start' &&
                            isActiveLoading &&
                            message.id === lastMessage?.id;
                          const resultCount = run.results?.length || 0;
                          // Expand only while in flight; auto-collapse when done
                          // so Process doesn't bury the answer. Explicit toggles win.
                          const expanded = toolRunOpen[run.id] ?? searching;
                          const googleLabel = (() => {
                            if (isGoogleWrite) {
                              return searching ? t('writingGoogle') : t('wroteGoogle');
                            }
                            if (isGmail) {
                              return searching ? t('searchingGmail') : t('searchedGmail');
                            }
                            if (isCalendar) {
                              return searching ? t('searchingCalendar') : t('searchedCalendar');
                            }
                            if (isDrive) {
                              return searching ? t('searchingDrive') : t('searchedDrive');
                            }
                            return searching ? t('searchingGoogle') : t('searchedGoogle');
                          })();
                          const label = isGoogle
                            ? failed
                              ? t('toolFailed')
                              : googleLabel
                            : searching
                              ? isNotionWrite
                                ? t('writingNotion')
                                : isNotionFetch
                                  ? t('readingNotion')
                                  : isNotion
                                    ? t('searchingNotion')
                                    : isGitHub
                                      ? t('searchingGitHub')
                                      : isImageUnderstand
                                        ? t('understandingImage')
                                        : isWebRead
                                          ? t('readingWeb')
                                          : t('searchingWeb')
                              : failed
                                ? t('toolFailed')
                                : isNotionWrite
                                  ? t('wroteNotion')
                                  : isNotionFetch
                                    ? t('readNotion')
                                    : isNotion
                                      ? t('searchedNotion')
                                      : isGitHub
                                        ? t('searchedGitHub')
                                        : isImageUnderstand
                                          ? t('understoodImage')
                                          : isWebRead
                                            ? t('readWeb')
                                            : t('searchedWeb');
                          return (
                            <div key={step.id} className="overflow-hidden">
                              <button
                                type="button"
                                onClick={() =>
                                  setToolRunOpen((prev) => ({
                                    ...prev,
                                    [run.id]: !(prev[run.id] ?? searching),
                                  }))
                                }
                                className={cn(
                                  'flex w-full items-center gap-1.5 py-0.5 text-left text-[12px] leading-5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300',
                                  failed &&
                                    'text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300',
                                )}
                              >
                                <ChevronDown
                                  className={cn(
                                    'h-3 w-3 shrink-0 opacity-60 transition-transform',
                                    expanded ? 'rotate-0' : '-rotate-90',
                                  )}
                                />
                                {searching ? (
                                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-stone-500 dark:text-stone-400" />
                                ) : isNotion ? (
                                  <NotionLogo className="h-3 w-3 shrink-0" />
                                ) : isGitHub ? (
                                  <GitHubLogo className="h-3 w-3 shrink-0" />
                                ) : isGoogle ? (
                                  <GoogleLogo className="h-3 w-3 shrink-0" />
                                ) : isImageUnderstand ? (
                                  <ImageIcon className="h-3 w-3 shrink-0 opacity-60" />
                                ) : (
                                  <Globe className="h-3 w-3 shrink-0 opacity-60" />
                                )}
                                <span>{label}</span>
                                {run.status === 'done' &&
                                  run.provider &&
                                  run.provider !== 'none' &&
                                  !isNotion &&
                                  !isGitHub &&
                                  !isGoogle &&
                                  !isImageUnderstand && (
                                    <span className="opacity-50">
                                      {t('searchedVia').replace(
                                        '{provider}',
                                        run.provider,
                                      )}
                                    </span>
                                  )}
                                {run.query && (isNotion || isGoogle) && !searching && (
                                  <span className="min-w-0 truncate opacity-50">
                                    ·{' '}
                                    {isNotionFetch && run.results?.[0]?.title
                                      ? run.results[0].title
                                      : run.query}
                                  </span>
                                )}
                              </button>
                              {expanded && (
                                <div className="space-y-1 pb-1 pl-5 text-[12px] leading-5 text-stone-500 dark:text-stone-400">
                                  {searching && <div>{t('fetchingResults')}</div>}
                                  {run.error && (
                                    <div className="text-red-600 dark:text-red-400">
                                      {run.error}
                                    </div>
                                  )}
                                  {run.status === 'done' && resultCount > 0 && (
                                    <ul className={cn('space-y-2', !isImageUnderstand && 'space-y-0.5')}>
                                      {(run.results || []).slice(0, 8).map((r) => (
                                        <li
                                          key={r.url || r.title || r.snippet?.slice(0, 40)}
                                          className={
                                            isImageUnderstand
                                              ? 'break-words'
                                              : 'truncate'
                                          }
                                        >
                                          {r.url && !isImageUnderstand ? (
                                            <a
                                              href={r.url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-stone-600 underline-offset-2 hover:underline dark:text-stone-300"
                                              title={r.snippet || r.title}
                                            >
                                              {r.title || r.url}
                                            </a>
                                          ) : isImageUnderstand ? (
                                            <div className="chat-markdown text-[12px] leading-5 text-stone-500 dark:text-stone-400">
                                              <ReactMarkdown
                                                remarkPlugins={[remarkMath, remarkGfm]}
                                                rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
                                                components={{
                                                  p({ children }) {
                                                    return (
                                                      <p className="m-0 whitespace-pre-wrap leading-5">
                                                        {children}
                                                      </p>
                                                    );
                                                  },
                                                  h1({ children }) {
                                                    return (
                                                      <h3 className="mb-1 mt-2 text-[12px] font-semibold text-stone-600 dark:text-stone-300">
                                                        {children}
                                                      </h3>
                                                    );
                                                  },
                                                  h2({ children }) {
                                                    return (
                                                      <h3 className="mb-1 mt-2 text-[12px] font-semibold text-stone-600 dark:text-stone-300">
                                                        {children}
                                                      </h3>
                                                    );
                                                  },
                                                  h3({ children }) {
                                                    return (
                                                      <h3 className="mb-1 mt-2 text-[12px] font-semibold text-stone-600 dark:text-stone-300">
                                                        {children}
                                                      </h3>
                                                    );
                                                  },
                                                  ul({ children }) {
                                                    return (
                                                      <ul className="my-1 list-disc space-y-0.5 pl-5">
                                                        {children}
                                                      </ul>
                                                    );
                                                  },
                                                  ol({ children }) {
                                                    return (
                                                      <ol className="my-1 list-decimal space-y-0.5 pl-5">
                                                        {children}
                                                      </ol>
                                                    );
                                                  },
                                                  li({ children }) {
                                                    return <li className="leading-5">{children}</li>;
                                                  },
                                                  code({ children }) {
                                                    return (
                                                      <code className="rounded bg-stone-200/60 px-1 py-0.5 font-mono text-[11px] dark:bg-stone-800">
                                                        {children}
                                                      </code>
                                                    );
                                                  },
                                                }}
                                              >
                                                {prepareChatMarkdown(r.snippet || r.title || '')}
                                              </ReactMarkdown>
                                            </div>
                                          ) : (
                                            <span title={r.snippet || r.title}>{r.title}</span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {run.status === 'done' && emptyResults && (
                                    <div>{t('searchNoResults')}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        };

                        const renderAnswerMarkdown = (text: string, streaming: boolean) => (
                          <div className="chat-markdown w-full text-stone-800 dark:text-stone-200 leading-relaxed text-[15px] space-y-3">
                            <ReactMarkdown
                              remarkPlugins={[remarkMath, remarkGfm]}
                              rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
                              components={{
                                p({ children }: any) {
                                  return <p className="mb-4 leading-7 last:mb-0">{children}</p>;
                                },
                                h1({ children }: any) {
                                  return <h1 className="text-xl font-bold mt-6 mb-3 text-stone-900 dark:text-stone-100">{children}</h1>;
                                },
                                h2({ children }: any) {
                                  return <h2 className="text-lg font-bold mt-5 mb-2.5 text-stone-900 dark:text-stone-100">{children}</h2>;
                                },
                                h3({ children }: any) {
                                  return <h3 className="text-base font-bold mt-4 mb-2 text-stone-900 dark:text-stone-100">{children}</h3>;
                                },
                                ul({ children }: any) {
                                  return <ul className="my-3 pl-6 list-disc space-y-1">{children}</ul>;
                                },
                                ol({ children }: any) {
                                  return <ol className="my-3 pl-6 list-decimal space-y-1">{children}</ol>;
                                },
                                li({ children }: any) {
                                  return <li className="leading-6">{children}</li>;
                                },
                                a({ href, children }: any) {
                                  return (
                                    <a
                                      href={href}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-orange-700 underline decoration-orange-300/80 underline-offset-2 hover:text-orange-800 dark:text-orange-300 dark:decoration-orange-700/80 dark:hover:text-orange-200"
                                    >
                                      {children}
                                    </a>
                                  );
                                },
                                blockquote({ children }: any) {
                                  return (
                                    <blockquote className="my-3 border-l-[3px] border-stone-300 pl-3 text-[13px] leading-5 text-stone-500 not-italic dark:border-stone-600 dark:text-stone-400 [&_p]:mb-0 [&_p]:leading-5 [&_.katex]:text-[0.95em] [&_.katex-display]:my-2 [&_.katex-error]:text-inherit">
                                      {children}
                                    </blockquote>
                                  );
                                },
                                table({ children }: any) {
                                  return (
                                    <div className="my-4 w-full overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
                                      <table className="w-full text-left text-sm">{children}</table>
                                    </div>
                                  );
                                },
                                thead({ children }: any) {
                                  return <thead className="bg-stone-100 dark:bg-stone-900 text-stone-900 dark:text-stone-100 font-semibold">{children}</thead>;
                                },
                                tbody({ children }: any) {
                                  return <tbody className="divide-y divide-stone-200 dark:divide-stone-800">{children}</tbody>;
                                },
                                tr({ children }: any) {
                                  return <tr className="hover:bg-stone-50/50 dark:hover:bg-stone-900/50">{children}</tr>;
                                },
                                th({ children }: any) {
                                  return <th className="px-3.5 py-2.5 font-semibold">{children}</th>;
                                },
                                td({ children }: any) {
                                  return <td className="px-3.5 py-2.5 align-top">{children}</td>;
                                },
                                code({ inline, className, children, ...props }: any) {
                                  const match = /language-(\w+)/.exec(className || '');
                                  const value = String(children).replace(/\n$/, '');
                                  if (!inline && match) {
                                    return <CodeBlock language={match[1]} value={value} />;
                                  }
                                  return (
                                    <code {...props} className="rounded bg-stone-200/60 px-1.5 py-0.5 text-xs font-mono text-stone-900 dark:bg-stone-800 dark:text-stone-100">
                                      {children}
                                    </code>
                                  );
                                },
                                pre({ children }: any) { return <>{children}</>; },
                              }}
                            >
                              {prepareChatMarkdown(text, { streaming })}
                            </ReactMarkdown>
                          </div>
                        );

                        const renderReasoningStep = (
                          step: Extract<ProcessStep, { kind: 'reasoning' }>,
                          live: boolean,
                        ) => {
                          const body = step.text.trim();
                          if (!body && !live) return null;
                          // Open while thinking so it streams in view, then auto-collapse
                          // once the answer starts. Explicit user toggles win.
                          const open = reasoningOpen[step.id] ?? live;
                          return (
                            <div key={step.id} className="overflow-hidden">
                              <button
                                type="button"
                                onClick={() =>
                                  setReasoningOpen((prev) => ({
                                    ...prev,
                                    [step.id]: !(prev[step.id] ?? true),
                                  }))
                                }
                                className="flex w-full items-center gap-1.5 py-0.5 text-left text-[12px] leading-5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300"
                              >
                                <ChevronDown
                                  className={cn(
                                    'h-3 w-3 shrink-0 opacity-60 transition-transform',
                                    open ? 'rotate-0' : '-rotate-90',
                                  )}
                                />
                                {live ? (
                                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                                ) : (
                                  <Sparkles className="h-3 w-3 shrink-0 opacity-70" />
                                )}
                                <span>{live ? t('thinking') : t('thought')}</span>
                              </button>
                              {open && body && (
                                <div className="chat-markdown mt-0.5 max-h-72 overflow-y-auto pl-[18px] text-[12px] leading-5 text-stone-500 dark:text-stone-400">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkMath, remarkGfm]}
                                    rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
                                    components={{
                                      p({ children }) {
                                        return (
                                          <p className="whitespace-pre-wrap m-0 leading-5">
                                            {children}
                                          </p>
                                        );
                                      },
                                      code({ className, children, ...props }) {
                                        const match = /language-(\w+)/.exec(className || '');
                                        const value = String(children).replace(/\n$/, '');
                                        if (match) {
                                          return <CodeBlock language={match[1]} value={value} />;
                                        }
                                        return (
                                          <code
                                            {...props}
                                            className="rounded bg-stone-200/60 px-1.5 py-0.5 text-[11px] font-mono text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                                          >
                                            {children}
                                          </code>
                                        );
                                      },
                                      ul({ children }) {
                                        return (
                                          <ul className="my-2 pl-6 list-disc space-y-0.5">
                                            {children}
                                          </ul>
                                        );
                                      },
                                      ol({ children }) {
                                        return (
                                          <ol className="my-2 pl-6 list-decimal space-y-0.5">
                                            {children}
                                          </ol>
                                        );
                                      },
                                      li({ children }) {
                                        return <li className="leading-6">{children}</li>;
                                      },
                                      blockquote({ children }) {
                                        return (
                                          <blockquote className="my-2 border-l-[3px] border-stone-300 pl-3 not-italic dark:border-stone-600">
                                            {children}
                                          </blockquote>
                                        );
                                      },
                                      pre({ children }) {
                                        return <>{children}</>;
                                      },
                                    }}
                                  >
                                    {prepareChatMarkdown(body, {
                                      streaming:
                                        isActiveLoading &&
                                        message.id === lastMessage?.id &&
                                        message.role === 'assistant',
                                    })}
                                  </ReactMarkdown>
                                </div>
                              )}
                            </div>
                          );
                        };

                        /** One step of a Process segment. `live` marks the trailing in-flight step. */
                        const renderProcessStep = (step: ProcessStep, live: boolean) =>
                          step.kind === 'reasoning'
                            ? renderReasoningStep(step, live)
                            : renderToolStep(step);

                        const renderProcessPanel = (seg: Extract<TimelineSegment, { type: 'process' }>) => {
                          // Hard gate: never spin unless this session is actually
                          // streaming. Incomplete alone (e.g. after refresh) is not live.
                          const segLive = Boolean(seg.live && isActiveLoading);
                          // While the stream is idle (replyWait), freeze Thought chrome;
                          // the textless gap spinner is rendered after the timeline.
                          const thoughtStreaming = segLive && !replyWait;
                          const lastIdx = seg.steps.length - 1;
                          const rendered = seg.steps
                            .map((step, i) =>
                              renderProcessStep(
                                step,
                                thoughtStreaming && i === lastIdx && step.kind === 'reasoning'
                                  ? true
                                  : segLive &&
                                      i === lastIdx &&
                                      step.kind === 'tool'
                                    ? true
                                    : false,
                              ),
                            )
                            .filter(Boolean);

                          // Nothing yet — do NOT label this as Thinking. Waiting for the
                          // first token is not the same as chain-of-thought; the textless
                          // gap spinner under the timeline covers that state.
                          if (rendered.length === 0) {
                            return null;
                          }

                          // A single step is self-describing (Thought / Searched the web …),
                          // so the outer "Process" header would only add noise.
                          if (rendered.length === 1) {
                            return <div key={seg.id}>{rendered}</div>;
                          }

                          const open = reasoningOpen[seg.id] ?? segLive;
                          const segStepCount = rendered.length;
                          return (
                            <div
                              key={seg.id}
                              className={cn(
                                'overflow-hidden',
                                open &&
                                  'rounded-md border border-stone-200/70 bg-stone-50/50 dark:border-stone-800/80 dark:bg-stone-900/40',
                              )}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setReasoningOpen((prev) => ({
                                    ...prev,
                                    [seg.id]: !(prev[seg.id] ?? true),
                                  }))
                                }
                                className={cn(
                                  'flex w-full items-center gap-1.5 py-0.5 text-left text-[12px] leading-5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300',
                                  open && 'px-2 pt-1.5',
                                )}
                              >
                                <ChevronDown
                                  className={cn(
                                    'h-3 w-3 shrink-0 opacity-60 transition-transform',
                                    open ? 'rotate-0' : '-rotate-90',
                                  )}
                                />
                                {segLive ? (
                                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-stone-500 dark:text-stone-400" />
                                ) : null}
                                <span>{t('process')}</span>
                                <span className="opacity-50">· {segStepCount}</span>
                              </button>
                              {open && (
                                <div className="space-y-1.5 px-2 pb-1.5 pl-6">{rendered}</div>
                              )}
                            </div>
                          );
                        };

                        const answerStreaming =
                          isActiveLoading &&
                          message.id === lastMessage?.id &&
                          message.role === 'assistant';

                        const toolPendingUi = (message.toolRuns || []).some(
                          (r) => r.status === 'start',
                        );
                        const hasReasoningActivity = activitySteps.some(
                          (s) => s.kind === 'reasoning' && String(s.text || '').trim(),
                        );
                        // Textless wait marker: first-token gap (no thought yet) OR idle
                        // after narration. Never pretends the model is "thinking".
                        const streamGapSpinner =
                          messageIsStreaming &&
                          message.incomplete &&
                          !toolPendingUi &&
                          (replyWait || (awaitingFirstContent && !hasReasoningActivity)) ? (
                            <div
                              className="flex items-center py-1.5"
                              aria-label={t('generatingReply')}
                            >
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-stone-400 dark:text-stone-500" />
                            </div>
                          ) : null;

                        return (
                          <>
                            {message.images && message.images.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {message.images.map((img, idx) => (
                                  <a
                                    key={idx}
                                    href={img.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900"
                                  >
                                    <img
                                      src={img.url}
                                      alt={img.name || 'generated'}
                                      className="max-h-[420px] max-w-full object-contain"
                                    />
                                  </a>
                                ))}
                              </div>
                            )}
                            {isAssistantError(message) ? (
                              <div className="rounded-xl border border-red-200 bg-red-50/80 px-3.5 py-3 dark:border-red-900/50 dark:bg-red-950/30">
                                <p className="text-sm font-medium text-red-700 dark:text-red-300">
                                  {t('requestFailed')}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-red-600/90 dark:text-red-400/90">
                                  {visibleContent.replace(/^Error:\s*/, '')}
                                </p>
                                {message.id === lastMessage?.id && canRetryFailed && (
                                  <button
                                    type="button"
                                    onClick={() => retryFailedReply()}
                                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                    {t('retry')}
                                  </button>
                                )}
                              </div>
                            ) : (
                              <>
                                {timelineSegments.map((seg) =>
                                  seg.type === 'process' ? (
                                    renderProcessPanel(seg)
                                  ) : (
                                    <div key={seg.id}>
                                      {renderAnswerMarkdown(
                                        seg.text,
                                        answerStreaming &&
                                          seg.id ===
                                            [...timelineSegments]
                                              .reverse()
                                              .find((s) => s.type === 'content')?.id,
                                      )}
                                    </div>
                                  ),
                                )}
                                {streamGapSpinner}
                              </>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </div>

        {/* Floating Input Area */}
        <div className="shrink-0 px-4 pb-6 pt-2 bg-gradient-to-t from-[#F9F8F6] via-[#F9F8F6] to-transparent dark:from-stone-950 dark:via-stone-950">
          <div className="mx-auto w-full max-w-[960px] px-1 md:px-4 relative">
            {/* Compact message queue */}
            <AnimatePresence>
              {activeQueue.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="mb-3 overflow-hidden rounded-2xl border border-stone-200/80 bg-white/90 shadow-sm backdrop-blur-sm dark:border-stone-700/80 dark:bg-stone-900/90"
                >
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-stone-100 dark:border-stone-800">
                    <button
                      type="button"
                      onClick={() => setQueueExpanded((v) => !v)}
                      className="flex min-w-0 items-center gap-2 text-left"
                    >
                      <ListOrdered className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                      <span className="text-xs font-medium text-stone-700 dark:text-stone-300">
                        {activeQueue.length} {t('queued')}
                      </span>
                      {queuePaused && (
                        <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          {t('queuePaused')}
                        </span>
                      )}
                      <ChevronDown
                        className={cn(
                          'h-3 w-3 shrink-0 text-stone-400 transition-transform',
                          queueExpanded ? 'rotate-180' : '',
                        )}
                      />
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {queuePaused && (
                        <button
                          type="button"
                          onClick={resumeQueue}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-950/30"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          {t('resumeQueue')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={clearQueue}
                        className="rounded-lg px-2 py-1 text-xs text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
                      >
                        {t('clear')}
                      </button>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {queueExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="max-h-36 overflow-y-auto"
                      >
                        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                          {activeQueue.map((task, idx) => (
                            <li
                              key={task.id}
                              className="group flex items-center gap-2 px-3 py-1.5 text-sm"
                            >
                              <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-stone-400">
                                {idx + 1}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-stone-600 dark:text-stone-300">
                                {task.content}
                              </span>
                              <button
                                type="button"
                                onClick={() => jumpQueueAndSubmit(task.id)}
                                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-orange-600 opacity-70 hover:bg-orange-50 hover:opacity-100 group-hover:opacity-100 dark:text-orange-400 dark:hover:bg-orange-950/30"
                              >
                                Send
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelQueuedMessage(task.id)}
                                className="shrink-0 rounded-md p-0.5 text-stone-300 opacity-70 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-950/20"
                                title="Remove"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>

            {(attachError || compactNotice) && (
              <div className="mb-2 text-center text-xs text-amber-700 dark:text-amber-300">
                {attachError || compactNotice}
              </div>
            )}

            {/* Continue — only when the last reply was clearly interrupted.
                Sits above the composer so it reads as "finish that reply".
                Failed requests use the Retry on the error card instead. */}
            <AnimatePresence>
              {canResumeIncomplete && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="mb-2 flex justify-center"
                >
                  <button
                    type="button"
                    onClick={() => resumeIncompleteReply()}
                    title={truncationInfo.reason || 'Continue the previous reply'}
                    className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3.5 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    Continue
                    {truncationInfo.reason && (
                      <span className="hidden sm:inline font-normal text-stone-500 dark:text-stone-400">
                        · {truncationInfo.reason}
                      </span>
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex flex-col rounded-2xl border border-stone-300 bg-white shadow-sm focus-within:ring-2 focus-within:ring-stone-400/20 focus-within:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:focus-within:border-stone-500 transition-all relative">
              {attachments.length > 0 && (
                <div className="px-3 pt-3 pb-1 flex flex-wrap gap-2">
                  {attachments.map((a) =>
                    isImageAttachment(a) ? (
                      <AttachmentImageThumb
                        key={a.id}
                        attachment={a}
                        onPreview={setImagePreviewSrc}
                        onRemove={() => removeAttachment(a.id)}
                      />
                    ) : (
                      <div
                        key={a.id}
                        className="group flex max-w-full items-center gap-2 rounded-xl border border-stone-200 bg-white px-2 py-1.5 text-xs shadow-sm dark:border-stone-700 dark:bg-stone-900"
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                        <span className="truncate text-stone-600 dark:text-stone-300">{a.name}</span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(a.id)}
                          className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-red-500 dark:hover:bg-stone-800"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ),
                  )}
                </div>
              )}
              {activeSkills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                  {activeSkills.map((skill) => (
                    <span
                      key={skill.id}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-stone-300 bg-stone-100 pl-2 pr-1 py-0.5 text-[11px] font-medium text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200"
                      title={`/${skillSlashName(skill.title)}`}
                    >
                      <ScrollText className="h-3 w-3 shrink-0" />
                      <span className="truncate">{skill.title}</span>
                      <button
                        type="button"
                        onClick={() => toggleSkill(skill.id)}
                        className="rounded-full p-0.5 hover:bg-stone-200 dark:hover:bg-stone-700"
                        title="移除 Skill"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {quotedSelections.length > 0 && (
                <div className="mx-3 mt-2 space-y-1 border-b border-stone-200/80 pb-2 dark:border-stone-700/80">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      {quotedSelections.length === 1
                        ? t('quoted')
                        : t('quotedCount', { n: quotedSelections.length })}
                    </div>
                    {quotedSelections.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setQuotedSelections([])}
                        className="text-[10px] font-medium text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                      >
                        {t('clearAllQuotes')}
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {quotedSelections.map((quote, index) => (
                      <div
                        key={`${index}-${quote.slice(0, 24)}`}
                        className="group flex items-start gap-1"
                      >
                        <blockquote className="min-w-0 flex-1 border-l-2 border-stone-400/70 py-0 pl-2.5 dark:border-stone-500">
                          <div className="chat-markdown chat-quote line-clamp-3 text-[12px] leading-4 text-stone-500 dark:text-stone-400 [&_p]:mb-0 [&_p]:leading-4">
                            <ReactMarkdown
                              remarkPlugins={[remarkMath, remarkGfm]}
                              rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
                              components={{
                                p({ children }: any) {
                                  return <p className="whitespace-pre-wrap">{children}</p>;
                                },
                                code({ children }: any) {
                                  return (
                                    <code className="rounded bg-stone-200/60 px-1 py-0.5 font-mono text-[11px] dark:bg-stone-800">
                                      {children}
                                    </code>
                                  );
                                },
                              }}
                            >
                              {prepareChatMarkdown(compactQuoteMath(quote))}
                            </ReactMarkdown>
                          </div>
                        </blockquote>
                        <button
                          type="button"
                          onClick={() => removeQuotedSelection(index)}
                          className="mt-0 shrink-0 rounded p-0.5 text-stone-400 opacity-70 hover:bg-stone-100 hover:text-stone-700 group-hover:opacity-100 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                          title={t('clearQuote')}
                          aria-label={t('clearQuote')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Slash-command menu: /image + Skills */}
              <AnimatePresence>
                {slashMenuItems.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className="absolute left-3 right-3 bottom-full mb-2 z-40 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-900"
                  >
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400 border-b border-stone-100 dark:border-stone-800">
                      Commands
                    </div>
                    {slashMenuItems.map((item, idx) => (
                      <button
                        key={item.kind === 'skill' ? item.skill.id : item.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          consumeSlashItem(item);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                          idx === slashHighlight
                            ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                            : 'text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800',
                        )}
                      >
                        {item.kind === 'command' ? (
                          <ImageIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                        ) : (
                          <ScrollText className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                        )}
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {item.kind === 'command' ? item.title : item.skill.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-stone-400">
                          {item.kind === 'command'
                            ? item.hint
                            : `/${skillSlashName(item.skill.title)}`}
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                {...bindImeGuards(composerImeComposingRef, composerImeEnterLockRef)}
                onPaste={onPasteFiles}
                placeholder={
                  modelsLoading
                    ? t('loadingModels')
                    : t('writeMessage', { model: selectedModel || 'AI' })
                }
                className="min-h-[60px] max-h-[300px] w-full resize-none border-0 bg-transparent px-4 py-4 text-base focus-visible:ring-0 placeholder:text-stone-400"
              />
              
              <div className="flex items-center justify-between px-3 pb-3 pt-1">
                <div className="flex items-center gap-1.5">
                  <div className="relative" ref={skillPickerRef}>
                    <button
                      ref={plusMenuButtonRef}
                      type="button"
                      onClick={() => {
                        setIsSkillPickerOpen((v) => {
                          const next = !v;
                          setPlusFlyout(null);
                          if (!next) {
                            queueMicrotask(() => plusMenuButtonRef.current?.blur());
                          }
                          return next;
                        });
                        setIsModelMenuOpen(false);
                        if (isAccountBound && skills.length === 0) fetchSkills();
                      }}
                      title="Add"
                      aria-expanded={isSkillPickerOpen}
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/40',
                        isSkillPickerOpen
                          ? 'bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100'
                          : 'text-stone-500 [@media(hover:hover)]:hover:bg-stone-100 dark:text-stone-400 dark:[@media(hover:hover)]:hover:bg-stone-800',
                      )}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <AnimatePresence>
                      {isSkillPickerOpen && (
                        <div className="absolute left-0 bottom-10 z-30">
                          <motion.div
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 5 }}
                            className="relative w-56 rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
                          >
                            <button
                              type="button"
                              onPointerEnter={() => setPlusFlyout(null)}
                              onClick={() => {
                                if (!isAccountBound) {
                                  setIsSkillPickerOpen(false);
                                  setPlusFlyout(null);
                                  openLoginModal();
                                  return;
                                }
                                setIsSkillPickerOpen(false);
                                setPlusFlyout(null);
                                setInput('/image ');
                                textareaRef.current?.focus();
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                            >
                              <ImageIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                              <span className="min-w-0 flex-1">{t('generateImage')}</span>
                              <span className="shrink-0 font-mono text-[10px] text-stone-400">
                                /image
                              </span>
                            </button>

                            <button
                              type="button"
                              onPointerEnter={() => {
                                setPlusFlyout('skills');
                                setGoogleMcpMenuOpen(false);
                                if (isAccountBound && skills.length === 0) fetchSkills();
                              }}
                              onClick={() => {
                                setPlusFlyout((v) => (v === 'skills' ? null : 'skills'));
                                setGoogleMcpMenuOpen(false);
                                if (isAccountBound && skills.length === 0) fetchSkills();
                              }}
                              className={cn(
                                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                                plusFlyout === 'skills'
                                  ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                                  : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800',
                              )}
                            >
                              <ScrollText className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                              <span className="min-w-0 flex-1">{t('skills')}</span>
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                            </button>

                            <button
                              type="button"
                              onPointerEnter={() => {
                                setPlusFlyout('mcp');
                                void fetchIntegrations();
                              }}
                              onClick={() => {
                                setPlusFlyout((v) => (v === 'mcp' ? null : 'mcp'));
                                void fetchIntegrations();
                              }}
                              className={cn(
                                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                                plusFlyout === 'mcp'
                                  ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                                  : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800',
                              )}
                            >
                              <Blocks className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                              <span className="min-w-0 flex-1">{t('mcpTools')}</span>
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                            </button>

                            <AnimatePresence>
                              {plusFlyout === 'skills' && (
                                <motion.div
                                  key="plus-skills-flyout"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0.1 }}
                                  onPointerEnter={() => {
                                    setPlusFlyout('skills');
                                    setGoogleMcpMenuOpen(false);
                                  }}
                                  className="absolute left-[calc(100%+6px)] top-[2.35rem] z-10 max-h-72 w-60 overflow-y-auto rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
                                >
                                {!isAccountBound ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsSkillPickerOpen(false);
                                      setPlusFlyout(null);
                                      openLoginModal();
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                                  >
                                    {t('connectAccount')}
                                  </button>
                                ) : skills.length === 0 ? (
                                  <div className="px-2.5 py-2 text-xs leading-5 text-stone-400">
                                    {t('noSkillsYet')}
                                  </div>
                                ) : (
                                  skills.map((skill) => {
                                    const on = activeSkillIds.includes(skill.id);
                                    return (
                                      <button
                                        key={skill.id}
                                        type="button"
                                        onClick={() => toggleSkill(skill.id)}
                                        className={cn(
                                          'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                                          on
                                            ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                                            : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800',
                                        )}
                                      >
                                        <ScrollText className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                                        <span className="min-w-0 flex-1 truncate">
                                          {skill.title}
                                        </span>
                                        {on ? (
                                          <Check className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                                        ) : (
                                          <span className="shrink-0 font-mono text-[10px] text-stone-400">
                                            /{skillSlashName(skill.title)}
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })
                                )}
                                </motion.div>
                              )}

                              {plusFlyout === 'mcp' && (
                                <motion.div
                                  key="plus-mcp-flyout"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0.1 }}
                                  onPointerEnter={() => {
                                    setPlusFlyout('mcp');
                                  }}
                                  className="absolute left-[calc(100%+6px)] bottom-0 z-10 w-60 rounded-xl border border-stone-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
                                >
                                <div
                                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-stone-400 dark:text-stone-500"
                                  title={
                                    selectedSpec.vision
                                      ? t('imageUnderstandDisabledOnVision')
                                      : t('zhipuVisionMcpHint')
                                  }
                                  aria-disabled
                                >
                                  <ImageIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm">{t('enableZhipuVisionMcp')}</div>
                                    <div className="truncate text-[10px] opacity-80">
                                      {selectedSpec.vision
                                        ? t('imageUnderstandDisabledOnVision')
                                        : t('imageUnderstandBuiltIn')}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                                  <NotionLogo className="h-3.5 w-3.5 shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm text-stone-800 dark:text-stone-100">
                                      Notion
                                    </div>
                                    <div className="truncate text-[10px] text-stone-400">
                                      {notionStatus?.connected
                                        ? t('useInThisChat')
                                        : t('notionMcpNeedsConnect')}
                                    </div>
                                  </div>
                                  {notionStatus?.connected ? (
                                    <Switch
                                      size="sm"
                                      checked={notionMcpOn}
                                      onCheckedChange={setNotionMcpEnabled}
                                      aria-label={t('enableNotionMcp')}
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsSkillPickerOpen(false);
                                        setPlusFlyout(null);
                                        openNotionModal();
                                      }}
                                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                    >
                                      {t('connectNotion')}
                                    </button>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                                  <GitHubLogo className="h-3.5 w-3.5 shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm text-stone-800 dark:text-stone-100">
                                      GitHub
                                    </div>
                                    <div className="truncate text-[10px] text-stone-400">
                                      {githubStatus?.connected
                                        ? t('useInThisChat')
                                        : t('githubMcpNeedsConnect')}
                                    </div>
                                  </div>
                                  {githubStatus?.connected ? (
                                    <Switch
                                      size="sm"
                                      checked={githubMcpOn}
                                      onCheckedChange={setGitHubMcpEnabled}
                                      aria-label={t('enableGitHubMcp')}
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsSkillPickerOpen(false);
                                        setPlusFlyout(null);
                                        openGitHubModal();
                                      }}
                                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                    >
                                      {t('connectGitHub')}
                                    </button>
                                  )}
                                </div>
                                <div>
                                  {googleStatus?.connected ? (
                                    <button
                                      type="button"
                                      onClick={() => setGoogleMcpMenuOpen((open) => !open)}
                                      className={cn(
                                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left',
                                        googleMcpMenuOpen && 'bg-stone-100 dark:bg-stone-800',
                                        '[@media(hover:hover)]:hover:bg-stone-100 dark:[@media(hover:hover)]:hover:bg-stone-800',
                                      )}
                                      aria-expanded={googleMcpMenuOpen}
                                    >
                                      <GoogleLogo className="h-3.5 w-3.5 shrink-0" />
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm text-stone-800 dark:text-stone-100">
                                          Google
                                        </div>
                                        <div className="truncate text-[10px] text-stone-400">
                                          {t('useInThisChat')}
                                        </div>
                                      </div>
                                      <ChevronDown
                                        className={cn(
                                          'h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform',
                                          googleMcpMenuOpen && 'rotate-180',
                                        )}
                                      />
                                    </button>
                                  ) : (
                                    <div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                                      <GoogleLogo className="h-3.5 w-3.5 shrink-0" />
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm text-stone-800 dark:text-stone-100">
                                          Google
                                        </div>
                                        <div className="truncate text-[10px] text-stone-400">
                                          {t('googleMcpNeedsConnect')}
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setIsSkillPickerOpen(false);
                                          setPlusFlyout(null);
                                          openGoogleModal();
                                        }}
                                        className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                      >
                                        {t('connectGoogle')}
                                      </button>
                                    </div>
                                  )}
                                  <AnimatePresence initial={false}>
                                    {googleStatus?.connected && googleMcpMenuOpen && (
                                      <motion.div
                                        key="google-mcp-inline"
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.15 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="ml-5 border-l border-stone-200 py-0.5 pl-2 dark:border-stone-700">
                                          {[
                                            {
                                              id: 'gmail' as const,
                                              label: t('enableGmailMcp'),
                                              on: gmailMcpOn,
                                            },
                                            {
                                              id: 'calendar' as const,
                                              label: t('enableCalendarMcp'),
                                              on: calendarMcpOn,
                                            },
                                            {
                                              id: 'drive' as const,
                                              label: t('enableDriveMcp'),
                                              on: driveMcpOn,
                                            },
                                          ].map((row) => (
                                            <div
                                              key={row.id}
                                              className="flex items-center gap-2 rounded-md px-2 py-1.5"
                                            >
                                              <div className="min-w-0 flex-1 truncate text-xs text-stone-700 dark:text-stone-200">
                                                {row.label}
                                              </div>
                                              <Switch
                                                size="sm"
                                                checked={row.on}
                                                onCheckedChange={(enabled) =>
                                                  setGoogleServiceEnabled(row.id, enabled)
                                                }
                                                aria-label={row.label}
                                              />
                                            </div>
                                          ))}
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              </motion.div>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        </div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="relative" ref={modelMenuRef}>
                    <button 
                      onClick={() => {
                        setIsModelMenuOpen((open) => {
                          if (open) setModelSearchQuery('');
                          return !open;
                        });
                      }}
                      className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg hover:bg-stone-100 text-xs font-medium text-stone-600 transition-colors dark:text-stone-400 dark:hover:bg-stone-800"
                    >
                      <span className="truncate max-w-[140px] sm:max-w-[200px] text-left">
                        {modelsLoading 
                          ? t('loadingModels')
                          : (availableModels.find(m => m.id === selectedModel)?.id || selectedModel || t('selectModel'))}
                      </span>
                      <ChevronDown className="h-3 w-3 text-stone-400" />
                    </button>

                    <AnimatePresence>
                      {isModelMenuOpen && (
                        <motion.div 
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 5 }}
                          className="absolute left-0 bottom-10 mb-2 z-30 flex w-[280px] sm:w-80 max-h-[420px] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-900"
                        >
                          <div className="shrink-0 space-y-2 border-b border-stone-100 p-2 dark:border-stone-800">
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
                              <input
                                ref={modelSearchRef}
                                type="text"
                                value={modelSearchQuery}
                                onChange={(e) => setModelSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                                placeholder={t('searchModels')}
                                className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-8 pr-8 text-xs text-stone-800 outline-none placeholder:text-stone-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-200/60 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-orange-700 dark:focus:ring-orange-900/40"
                              />
                              {modelSearchQuery && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModelSearchQuery('');
                                    modelSearchRef.current?.focus();
                                  }}
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
                                  aria-label="Clear search"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center justify-between px-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                                {isAccountBound ? t('allModels') : t('freeModels')}
                              </span>
                              <span className="text-[10px] text-stone-400">
                                {modelSearchQuery.trim()
                                  ? `${filteredModels.length} / ${availableModels.length}`
                                  : `${availableModels.length} models`}
                              </span>
                            </div>
                          </div>

                          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                          {availableModels.length === 0 && !modelsLoading && (
                            <div className="p-4 text-center text-xs text-stone-400">
                              {isAccountBound ? 'No models found. Check connection.' : 'No free models available.'}
                            </div>
                          )}
                          {modelsLoading && availableModels.length === 0 && (
                            <div className="p-4 text-center text-xs text-stone-400">
                              Loading...
                            </div>
                          )}
                          {availableModels.length > 0 && filteredModels.length === 0 && (
                            <div className="p-4 text-center text-xs text-stone-400">
                              No models match “{modelSearchQuery.trim()}”
                            </div>
                          )}
                          {filteredModels.map(m => {
                            // Vision models auto-disable Image Understand. Don't trap users:
                            // logged-in accounts can pick a text model again — we re-enable
                            // Image Understand on select. Guests still need a Vision model.
                            const blocked =
                              hasImages && !m.vision && !zhipuVisionOn && !isAccountBound;
                            const softWarn = hasImages && !m.vision && isAccountBound;
                            return (
                            <button
                              key={m.id}
                              disabled={blocked}
                              onClick={() => {
                                if (blocked) return;
                                if (hasImages && !m.vision && isAccountBound) {
                                  setActiveMcpIds((prev) =>
                                    prev.includes('zhipu-vision')
                                      ? prev
                                      : [...prev, 'zhipu-vision'],
                                  );
                                }
                                setSelectedModel(m.id);
                                setIsModelMenuOpen(false);
                                setModelSearchQuery('');
                              }}
                              className={cn(
                                "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left gap-2",
                                blocked && "opacity-40 cursor-not-allowed",
                                selectedModel === m.id 
                                  ? "bg-stone-100 text-stone-900 font-medium dark:bg-stone-800 dark:text-stone-100" 
                                  : "hover:bg-stone-100 text-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                              )}
                              title={
                                blocked
                                  ? t('imagesNeedVision')
                                  : softWarn
                                    ? t('imagesPreferVision')
                                    : undefined
                              }
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate">{m.id}</div>
                                {blocked && (
                                  <div className="text-[10px] text-stone-400">{t('textOnlyNeedsVision')}</div>
                                )}
                                {softWarn && (
                                  <div className="text-[10px] text-amber-600 dark:text-amber-400">
                                    {t('textOnlyViaImageUnderstand')}
                                  </div>
                                )}
                              </div>
                              <span
                                className="text-[9px] font-mono text-stone-400 shrink-0 tabular-nums"
                                title={m.context_window != null ? `${m.context_window.toLocaleString()} context` : 'Unknown context'}
                              >
                                {formatContextWindow(m.context_window)}
                              </span>
                              {m.vision && (
                                <span
                                  title="Vision"
                                  className="text-[8px] font-semibold leading-none rounded border border-stone-200 bg-stone-50 px-1 py-px text-stone-500 shrink-0 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400"
                                >
                                  V
                                </span>
                              )}
                              {m.tier === 'paid' ? (
                                <span className="text-[8px] font-semibold leading-none rounded bg-orange-500 px-1 py-px text-white shrink-0">
                                  Pro
                                </span>
                              ) : (
                                <span className="text-[8px] font-semibold leading-none rounded border border-orange-200 bg-orange-50 px-1 py-px text-orange-700 shrink-0 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-300">
                                  Free
                                </span>
                              )}
                              {selectedModel === m.id && <Check className="h-3.5 w-3.5 text-stone-500 shrink-0" />}
                            </button>
                            );
                          })}
                          </div>
                          {!isAccountBound && (
                            <div className="shrink-0 border-t border-stone-100 p-2 dark:border-stone-800">
                              <button 
                                onClick={() => { setIsModelMenuOpen(false); setModelSearchQuery(''); openLoginModal(); }}
                                className="w-full text-center text-xs font-medium text-orange-600 hover:underline"
                              >
                                🔓 Sign in to unlock {availableModels.length > 0 ? 'all models' : 'premium'}
                              </button>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {isActiveLoading ? (
                    <Button 
                      onClick={() => stopGenerating()}
                      size="icon" 
                      title={t('stop')}
                      className="h-8 w-8 rounded-full bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:text-stone-900"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                    </Button>
                  ) : (
                    <Button 
                      onClick={() => enqueueOrSubmit()}
                      disabled={(!input.trim() && quotedSelections.length === 0 && attachments.length === 0) || isCompacting}
                      size="icon" 
                      title="Send"
                      className={cn(
                        "h-8 w-8 rounded-full transition-all active:scale-95",
                        (input.trim() || attachments.length > 0)
                          ? "bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
                          : "bg-stone-200 text-stone-400 dark:bg-stone-800 dark:text-stone-500"
                      )}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        
      </div>

      {/* --- Context Panel --- */}
          <AnimatePresence>
            {isContextPanelOpen && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 280, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="h-full shrink-0 border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 flex flex-col"
              >
                <div className="flex h-14 items-center justify-between px-4 border-b border-stone-200/50 dark:border-stone-800/50 shrink-0">
                  <span className="font-semibold text-stone-700 dark:text-stone-300 text-sm">Context</span>
                  <Button variant="ghost" size="icon" onClick={() => setIsContextPanelOpen(false)} className="h-8 w-8 text-stone-500">
                    <PanelRightClose className="h-4 w-4" />
                  </Button>
                </div>

                <ScrollArea className="flex-1 px-4 py-4">
                  <div className="space-y-2">
                    {/* Generated pictures — collapsible history bars */}
                    <div className="rounded-xl border border-stone-200/80 dark:border-stone-800 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setPicturesExpanded((v) => !v)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50"
                      >
                        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500">
                          <ImageIcon className="h-3.5 w-3.5" />
                          {t('generationHistory')}
                          <span className="font-mono font-normal normal-case tracking-normal text-stone-400">
                            ({generatedImageHistory.length})
                          </span>
                        </span>
                        <div className="flex items-center gap-1">
                          {generatedImageHistory.length > 0 && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                clearGeneratedImages();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.stopPropagation();
                                  clearGeneratedImages();
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-stone-400 hover:text-red-500"
                            >
                              <Trash2 className="h-3 w-3" />
                              {t('clearHistory')}
                            </span>
                          )}
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 text-stone-400 transition-transform',
                              picturesExpanded && 'rotate-180',
                            )}
                          />
                        </div>
                      </button>
                      <AnimatePresence initial={false}>
                        {picturesExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="max-h-72 space-y-2 overflow-y-auto border-t border-stone-200/70 px-3 py-2.5 dark:border-stone-800">
                              {generatedImageHistory.length === 0 ? (
                                <div className="py-2 text-xs text-stone-400">
                                  {t('noGeneratedImages')}
                                </div>
                              ) : (
                                generatedImageHistory.map((entry) => (
                                  <div
                                    key={`${entry.messageId}-${entry.imageIndex}`}
                                    className="flex items-stretch gap-2 rounded-lg border border-stone-200 bg-stone-50/80 p-1.5 dark:border-stone-700 dark:bg-stone-900/40"
                                  >
                                    <a
                                      href={entry.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-stone-200 dark:bg-stone-800"
                                    >
                                      <img
                                        src={entry.url}
                                        alt=""
                                        className="h-full w-full object-cover"
                                      />
                                    </a>
                                    <div className="min-w-0 flex-1 py-0.5">
                                      <div className="truncate font-mono text-[10px] leading-4 text-stone-400">
                                        {formatGeneratedAt(entry.timestamp)}
                                        <span className="mx-1 text-stone-600">·</span>
                                        {entry.model}
                                      </div>
                                      <div className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-stone-700 dark:text-stone-200">
                                        {entry.prompt}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 flex-col justify-center gap-0.5">
                                      <button
                                        type="button"
                                        title={t('download')}
                                        onClick={() => void downloadGeneratedImage(entry)}
                                        className="rounded p-1 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                                      >
                                        <Download className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title={t('delete')}
                                        onClick={() => removeGeneratedImage(entry)}
                                        className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Reference Material — upload anchors + tool/web sources */}
                    <div className="rounded-xl border border-stone-200/80 dark:border-stone-800 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setReferenceExpanded((v) => !v)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50"
                      >
                        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500">
                          <Quote className="h-3.5 w-3.5" />
                          {t('referenceMaterial')}
                          {(userUploadReferences.length > 0 || webSources.length > 0) && (
                            <span className="rounded-md bg-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                              {userUploadReferences.length + webSources.length}
                            </span>
                          )}

                        </span>
                        <div className="flex items-center gap-1">
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 text-stone-400 transition-transform',
                              referenceExpanded && 'rotate-180',
                            )}
                          />
                        </div>
                      </button>
                      <AnimatePresence initial={false}>
                        {referenceExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="max-h-64 space-y-3 overflow-y-auto border-t border-stone-200/70 px-3 py-2.5 dark:border-stone-800">
                              {userUploadReferences.length > 0 && (
                                <div className="space-y-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setReferenceGroupsOpen((prev) => ({
                                        ...prev,
                                        uploads: !prev.uploads,
                                      }))
                                    }
                                    className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800/80"
                                  >
                                    <span>{t('uploadedReferenceFiles')} · {userUploadReferences.length}</span>
                                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', referenceGroupsOpen.uploads && 'rotate-180')} />
                                  </button>
                                  {referenceGroupsOpen.uploads && (
                                    <ul className="space-y-1">
                                      {userUploadReferences.map((src) => {
                                        const isImg = src.kind === 'image';
                                        return (
                                          <li key={`${src.messageId || 'pending'}-${src.title}-${src.url}`}>
                                            <button
                                              type="button"
                                              onClick={() => openUploadReference(src)}
                                              className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-100 dark:hover:bg-stone-800/80"
                                            >
                                              {isImg && src.url ? (
                                                <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-stone-200 dark:bg-stone-800">
                                                  <img src={src.url} alt="" className="h-full w-full object-cover" />
                                                </span>
                                              ) : (
                                                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" />
                                              )}
                                              <span className="min-w-0 flex-1">
                                                <span className="block truncate font-medium text-stone-700 dark:text-stone-200">{src.title}</span>
                                                {src.snippet ? (
                                                  <span className="mt-0.5 block line-clamp-3 whitespace-pre-wrap text-[11px] leading-4 text-stone-500">{src.snippet}</span>
                                                ) : null}
                                              </span>
                                            </button>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </div>
                              )}
                              {referenceSourceGroups.length > 0 && (
                                <div className={cn('space-y-1.5', userUploadReferences.length > 0 && 'border-t border-stone-100 pt-2 dark:border-stone-800')}>
                                  <div className="flex items-center justify-between gap-2 px-1.5">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">{t('searchedSources')}</span>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmClearSourcesOpen(true)}
                                      className="text-[10px] text-stone-400 hover:text-red-500"
                                    >
                                      {t('clearWebSources')}
                                    </button>
                                  </div>
                                  {referenceSourceGroups.map((group) => {
                                    const labelKey: {
                                      [K in ExternalReferenceSourceKind]:
                                        | 'webSearchGroup'
                                        | 'notionGroup'
                                        | 'githubGroup'
                                        | 'gmailGroup'
                                        | 'calendarGroup'
                                        | 'driveGroup'
                                        | 'googleGroup';
                                    } = {
                                      web: 'webSearchGroup',
                                      notion: 'notionGroup',
                                      github: 'githubGroup',
                                      gmail: 'gmailGroup',
                                      calendar: 'calendarGroup',
                                      drive: 'driveGroup',
                                      google: 'googleGroup',
                                    };
                                    const groupLabel = labelKey[group.kind];
                                    const isOpen = Boolean(referenceGroupsOpen[group.kind]);
                                    return (
                                      <div key={group.kind} className="rounded-md bg-stone-50/70 dark:bg-stone-900/40">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setReferenceGroupsOpen((prev) => ({
                                              ...prev,
                                              [group.kind]: !prev[group.kind],
                                            }))
                                          }
                                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800/80"
                                        >
                                          <span>{t(groupLabel)} · {group.sources.length}</span>
                                          <ChevronDown className={cn('h-3.5 w-3.5 text-stone-400 transition-transform', isOpen && 'rotate-180')} />
                                        </button>
                                        {isOpen && (
                                          <ul className="space-y-1 px-1.5 pb-1.5">
                                            {group.sources.map((src) => (
                                              <li key={src.url}>
                                                <a
                                                  href={src.url}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="block truncate rounded-md px-1.5 py-1 text-xs text-stone-600 hover:bg-stone-100 hover:underline dark:text-stone-300 dark:hover:bg-stone-800/80"
                                                  title={src.snippet || src.title}
                                                >
                                                  {src.title || src.url}
                                                </a>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* System Prompt — collapsible */}
                    <div className="rounded-xl border border-stone-200/80 dark:border-stone-800 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setSystemPromptExpanded((v) => !v)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50"
                      >
                        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500">
                          <Settings2 className="h-3.5 w-3.5" />
                          System Prompt
                        </span>
                        <div className="flex items-center gap-1">
                          {systemPrompt.trim() && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSystemPrompt('');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.stopPropagation();
                                  setSystemPrompt('');
                                }
                              }}
                              className="rounded px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-stone-400 hover:text-red-500"
                            >
                              Reset
                            </span>
                          )}
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 text-stone-400 transition-transform',
                              systemPromptExpanded && 'rotate-180',
                            )}
                          />
                        </div>
                      </button>
                      <AnimatePresence initial={false}>
                        {systemPromptExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-2 border-t border-stone-200/70 px-3 py-2.5 dark:border-stone-800">
                              <div className="flex flex-wrap gap-1.5">
                                {SYSTEM_PRESETS.map((preset) => (
                                  <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => setSystemPrompt(preset.value)}
                                    className={cn(
                                      'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                                      systemPrompt === preset.value
                                        ? 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300'
                                        : 'border-stone-200 text-stone-500 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800',
                                    )}
                                  >
                                    {preset.label}
                                  </button>
                                ))}
                              </div>
                              <Textarea
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                                placeholder="You are a helpful AI..."
                                className="min-h-24 border-stone-200 bg-stone-50 text-xs dark:border-stone-800 dark:bg-stone-900/50"
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </ScrollArea>

                <div className="p-4 border-t border-stone-200/50 dark:border-stone-800/50 shrink-0 bg-stone-50 dark:bg-stone-900/50 text-xs text-stone-500 space-y-1.5">
                  <div className="flex justify-between">
                    <span>Messages</span>
                    <span className="font-mono text-stone-700 dark:text-stone-300">{messages.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Model window</span>
                    <span className="font-mono text-stone-700 dark:text-stone-300 text-right">
                      {contextLimit != null ? (
                        <>
                          {contextLimit.toLocaleString()}
                          <span className="block text-[10px] font-sans font-normal text-stone-400 truncate max-w-[140px]">
                            {selectedModel || '—'}
                          </span>
                        </>
                      ) : (
                        'unknown'
                      )}
                    </span>
                  </div>

                  {usableLimit != null && (
                    <div className="pt-1.5 space-y-1.5 border-t border-stone-200/60 dark:border-stone-800/60">
                      <div className="flex justify-between font-medium">
                        <span>Context used</span>
                        <span className={cn(
                          'font-mono',
                          usageRatio != null && usageRatio >= 0.9
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-stone-700 dark:text-stone-300',
                        )}>
                          ~{estimatedTokens.toLocaleString()} / {usableLimit.toLocaleString()}
                          {usageRatio != null && (
                            <span className="text-stone-400 font-normal">
                              {' '}({Math.round(usageRatio * 100)}%)
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            usageRatio != null && usageRatio >= 0.9 ? 'bg-amber-500' : 'bg-orange-500',
                          )}
                          style={{ width: `${Math.min((usageRatio || 0) * 100, 100)}%` }}
                        />
                      </div>
                      {usageRatio != null && usageRatio >= 0.85 && (
                        <button
                          type="button"
                          disabled={isCompacting || messages.length < 4}
                          onClick={async () => {
                            const next = await runCompact(messages);
                            if (next) updateActiveSession(next);
                          }}
                          className="w-full rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
                        >
                          {isCompacting ? 'Compacting…' : 'Compact now'}
                        </button>
                      )}
                    </div>
                  )}

                  {contextSources.length > 1 && usableLimit != null && (
                    <div className="pt-1.5 space-y-1 border-t border-stone-200/60 dark:border-stone-800/60">
                      {contextSources.map(([label, tokens]) => (
                        <div key={label} className="flex justify-between text-[11px]">
                          <span className="text-stone-400">{label}</span>
                          <span className="font-mono text-stone-500">
                            {tokens.toLocaleString()}
                            <span className="text-stone-400">
                              {' '}({Math.round((tokens / usableLimit) * 100)}%)
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Floating quote action for message text selection.
          Outer wrapper owns fixed positioning + translate so nothing can
          clobber `translate(-50%, -100%)` and drop the chip onto the text.
          Visibility/position are written via the ref (no setState). */}
      <div
        ref={quoteToolbarWrapRef}
        style={{
          position: 'fixed',
          display: 'none',
          left: 0,
          top: 0,
          transform: 'translate(-50%, -100%)',
          zIndex: 60,
          pointerEvents: 'none',
        }}
      >
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            quoteSelectedText(quoteToolbarTextRef.current);
          }}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
        >
          <Quote className="h-3.5 w-3.5 text-orange-500" />
          {t('quote')}
        </button>
      </div>

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
                    一句话描述（可选，给 AI 生成用）
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={skillDraftBrief}
                      onChange={(e) => setSkillDraftBrief(e.target.value)}
                      placeholder="例如：严谨的中文代码审查助手，只指出问题并给改法"
                      className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-orange-400 dark:border-stone-700 dark:bg-stone-900/60"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={generateSkillWithAI}
                      disabled={isGeneratingSkill}
                      className="shrink-0 rounded-xl"
                    >
                      {isGeneratingSkill ? (
                        <Loader2 className="h-4 w-4 animate-spin text-stone-600 dark:text-stone-300" />
                      ) : (
                        <Sparkles className="h-4 w-4 text-orange-500" />
                      )}
                      <span className="ml-1.5">{isGeneratingSkill ? '生成中' : 'AI 生成'}</span>
                    </Button>
                  </div>
                </div>

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
                    onClick={() => createSkill(skillDraftTitle, skillDraftContent)}
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

    </div>
  );
}