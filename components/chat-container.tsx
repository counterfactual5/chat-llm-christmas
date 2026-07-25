'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, Bot, User, Loader2, RefreshCw, Copy, Check, Trash2, 
  Menu, Plus, MessageSquare, Settings2, Image as ImageIcon, 
  Mic, Square, Download, Key, Sparkles, ChevronDown, Wallet, LogOut, X,
  MoreHorizontal, Clock, FileText, PanelRightOpen, PanelRightClose, Quote,
  Play, ListOrdered
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { CodeBlock } from './markdown/code-block';
import { ingestFiles, type IngestedAttachment } from '@/lib/file-ingest';
import {
  DEFAULT_SYSTEM_PROMPT,
  estimateTokensFromText,
  getModelSpec,
} from '@/lib/model-specs';

const MATH_ENVIRONMENTS = [
  'aligned', 'align', 'alignat', 'gather', 'gathered', 'split', 'multline',
  'equation', 'eqnarray', 'cases', 'array',
  'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix',
].join('|');

function normalizeMathDelimiters(content: string) {
  // Fenced code must never be rewritten as math, so park it first.
  const fences: string[] = [];
  let working = content.replace(/```[\s\S]*?(?:```|$)/g, (block) => {
    fences.push(block);
    return `\u0000F${fences.length - 1}\u0000`;
  });

  working = working
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expression) => `$${expression.trim()}$`);

  // Models often emit bare \begin{aligned}…\end{aligned} with no delimiters.
  // Wrap those, but leave environments that already sit inside a $$ block alone.
  const envPattern = new RegExp(
    `\\\\begin\\{(${MATH_ENVIRONMENTS})\\*?\\}[\\s\\S]*?\\\\end\\{\\1\\*?\\}`,
    'g',
  );
  working = working
    .split(/(\$\$[\s\S]*?\$\$)/g)
    .map((segment) =>
      segment.startsWith('$$')
        ? segment
        : segment.replace(envPattern, (match) => `\n$$\n${match}\n$$\n`),
    )
    .join('');

  return working.replace(/\u0000F(\d+)\u0000/g, (_, index) => fences[Number(index)]);
}

/** Natural terminators reported by upstream providers. */
const NATURAL_STOPS = new Set(['stop', 'end_turn', 'tool_calls', 'function_call']);

/**
 * Decide whether a reply was cut off. Prefer the provider's finish_reason;
 * fall back to structural signals and the incomplete flag set by Stop / refresh.
 * Missing finish_reason alone is NOT treated as truncation — many providers
 * omit it on a clean stop, and old saved messages never had one.
 */
function analyzeTruncation(
  content: string,
  finishReason?: string | null,
  incomplete?: boolean,
  storedReason?: string,
): { truncated: boolean; reason: string } {
  const text = (content || '').trimEnd();
  if (!text) return { truncated: false, reason: '' };

  if (storedReason) {
    return { truncated: true, reason: storedReason };
  }

  if (finishReason === 'length' || finishReason === 'max_tokens') {
    return { truncated: true, reason: 'Hit the output token limit' };
  }
  if (finishReason === 'content_filter') {
    return { truncated: true, reason: 'Blocked by content filter' };
  }

  // Strong structural signals — reply is unfinished regardless of finish_reason.
  if ((text.match(/```/g) || []).length % 2 === 1) {
    return { truncated: true, reason: 'Unclosed code block' };
  }
  if ((text.match(/\$\$/g) || []).length % 2 === 1) {
    return { truncated: true, reason: 'Unclosed math block' };
  }

  if (finishReason && !NATURAL_STOPS.has(finishReason)) {
    return { truncated: true, reason: `Stopped early (${finishReason})` };
  }

  // User hit Stop / page refreshed mid-stream.
  if (incomplete) {
    return { truncated: true, reason: 'Reply was interrupted' };
  }

  return { truncated: false, reason: '' };
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
  if (!insideCodeBlock && !insideMath && !insideTable) {
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
  images?: Array<{ url: string; name?: string }>;
  /** Marks a synthetic compacted-history bubble. */
  compacted?: boolean;
  /** Model chain-of-thought / reasoning stream, shown in a collapsible panel. */
  reasoning?: string;
  /** True while streaming, or after a stop / refresh / truncated reply. */
  incomplete?: boolean;
  /** Raw finish_reason from upstream, kept so Resume can explain itself. */
  finishReason?: string | null;
  /** Human-readable explanation of why the reply looks cut off. */
  truncationReason?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
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
  return message.content || '';
}

function sessionHasImages(messages: Message[], pending: IngestedAttachment[]): boolean {
  if (pending.some((a) => Boolean(a.dataUrl || a.type.startsWith('image/')))) return true;
  return messages.some((m) => (m.images?.length || 0) > 0);
}

function toApiMessages(messages: Message[]) {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    images: m.images?.map((img) => img.url) || [],
  }));
}

export default function ChatContainer() {
  // State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState('');
  
  // Model & Auth State
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [isAccountBound, setIsAccountBound] = useState(false);
  const [tempKeyInput, setTempKeyInput] = useState<string>('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [userBalance, setUserBalance] = useState<string | null>(null);

  // Settings State
  const [sessionMenuOpenId, setSessionMenuOpenId] = useState<string | null>(null);

  // Context & attachment state
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [referenceText, setReferenceText] = useState('');
  const [attachments, setAttachments] = useState<IngestedAttachment[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [compactNotice, setCompactNotice] = useState('');
  const [isCompacting, setIsCompacting] = useState(false);

  // Settings State
  const [isListening, setIsListening] = useState(false);
  const [isWaitingForFirstToken, setIsWaitingForFirstToken] = useState(false);
  const [messageQueue, setMessageQueue] = useState<Array<{ id: string; content: string; baseMessages?: Message[]; enqueueTime: number }>>([]);
  // Stop should freeze the queue; only explicit Continue / Send Now resumes it.
  const [queuePaused, setQueuePaused] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(true);
  /** Explicit open/closed overrides for reasoning panels (message id → open). */
  const [reasoningOpen, setReasoningOpen] = useState<Record<string, boolean>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dragDepthRef = useRef(0);
  // Only auto-follow new tokens while the user is already near the bottom.
  const stickToBottomRef = useRef(true);

  // Load Saved State
  useEffect(() => {
    // Migrate away from the old insecure client-side key storage.
    localStorage.removeItem('llm_christmas_user_key');

    // Detect whether a personal API key is already bound in the HttpOnly cookie.
    fetch('/api/account', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        const bound = Boolean(data?.bound);
        setIsAccountBound(bound);
        fetchModels();
        
        if (bound) {
          // Connected user: load their chats from localStorage
          const savedChats = localStorage.getItem('llm_christmas_chats');
          if (savedChats) {
            try {
              const parsed = JSON.parse(savedChats) as ChatSession[];
              // Only restore conversations that already have messages.
              // Empty drafts are never persisted / shown in the sidebar.
              const nonEmpty = parsed.filter((session) => session.messages?.length > 0);
              if (nonEmpty.length > 0) {
                setSessions(nonEmpty);
                setActiveSessionId(nonEmpty[0].id);
              } else {
                createNewSession();
              }
            } catch (e) { createNewSession(); }
          } else {
            createNewSession();
          }
        } else {
          // Guest user: start with a fresh memory-only session. Ignore anything saved.
          createNewSession();
        }
      })
      .catch(() => {
        fetchModels();
        createNewSession();
      });
  }, []);

  // Save Sessions ONLY if account is bound — never persist empty drafts
  useEffect(() => {
    if (!isAccountBound) return;
    const persisted = sessions.filter((session) => session.messages.length > 0);
    if (persisted.length > 0) {
      localStorage.setItem('llm_christmas_chats', JSON.stringify(persisted));
    } else {
      localStorage.removeItem('llm_christmas_chats');
    }
  }, [sessions, isAccountBound]);

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const messages = activeSession?.messages || [];
  const lastMessage = messages[messages.length - 1];
  const isAssistantError = (m?: Message) =>
    Boolean(m && m.role === 'assistant' && m.content.trim().startsWith('Error:'));
  const truncationInfo = useMemo(() => {
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return { truncated: false, reason: '' };
    }
    // Failed requests need Retry, not Continue-from-partial.
    if (!lastMessage.content?.trim() || isAssistantError(lastMessage)) {
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
  const canResumeIncomplete = !isLoading && truncationInfo.truncated;
  // Timeout / upstream failures leave an Error: bubble — offer Retry for that turn.
  const canRetryFailed = !isLoading && isAssistantError(lastMessage);
  // Empty drafts stay in state for the composer, but do not appear in the sidebar
  // until the first message is sent.
  const sidebarSessions = useMemo(
    () => sessions.filter((session) => session.messages.length > 0),
    [sessions],
  );

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
  }, [messages, isLoading]);

  // Switching conversations should land at the latest message.
  useEffect(() => {
    stickToBottomRef.current = true;
    scrollToBottom(true);
  }, [activeSessionId]);

  // --- Actions ---
  const createNewSession = () => {
    // Switch to a blank composer. The draft is kept in memory only and is
    // omitted from the sidebar until the first message lands.
    setSessions((prev) => {
      const emptyDraft = prev.find((session) => session.messages.length === 0);
      if (emptyDraft) {
        setActiveSessionId(emptyDraft.id);
        return prev.filter(
          (session) => session.messages.length > 0 || session.id === emptyDraft.id,
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

  const updateActiveSession = (newMessages: Message[], title?: string) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === activeSessionId);
      if (!exists) {
        // First message on a missing draft — materialize the session now.
        const created: ChatSession = {
          id: activeSessionId || crypto.randomUUID(),
          title: title || 'New Conversation',
          messages: newMessages,
          updatedAt: Date.now(),
        };
        if (!activeSessionId) setActiveSessionId(created.id);
        return [created, ...prev.filter((s) => s.messages.length > 0)];
      }
      return prev.map((s) => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            messages: newMessages,
            title: title || s.title,
            updatedAt: Date.now(),
          };
        }
        return s;
      });
    });
  };

  const markAssistantIncomplete = (
    assistantId: string,
    incomplete: boolean,
    meta?: { finishReason?: string | null; truncationReason?: string },
  ) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
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

  const appendToAssistant = (assistantId: string, chunk: string) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const msgs = s.messages.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + chunk, incomplete: true } : m,
        );
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }),
    );
  };

  const appendToAssistantReasoning = (assistantId: string, chunk: string) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const msgs = s.messages.map((m) =>
          m.id === assistantId
            ? { ...m, reasoning: (m.reasoning || '') + chunk, incomplete: true }
            : m,
        );
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }),
    );
  };

  const streamChatResponse = async (
    apiMessages: ReturnType<typeof toApiMessages>,
    assistantId: string,
    signal: AbortSignal,
    /** Text already present in the bubble, so Resume analyzes the whole reply. */
    initialContent = '',
    /** Inserted before the first resumed chunk to keep Markdown structure intact. */
    seamPrefix = '',
  ) => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: apiMessages,
        model: selectedModel,
        systemPrompt,
        referenceText,
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
    let streamed = initialContent;
    let seamPending = Boolean(seamPrefix);

    const settle = () => {
      const verdict = analyzeTruncation(streamed, finishReason);
      markAssistantIncomplete(assistantId, verdict.truncated, {
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
          settle();
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.finish_reason) finishReason = parsed.finish_reason;
          if (parsed.reasoning) {
            // Reasoning counts as activity — hide the empty dots placeholder.
            setIsWaitingForFirstToken(false);
            appendToAssistantReasoning(assistantId, parsed.reasoning);
          }
          if (parsed.content) {
            setIsWaitingForFirstToken(false);
            let chunk = parsed.content as string;
            if (seamPending) {
              seamPending = false;
              // Skip the seam if the model already emitted the break itself.
              if (!chunk.startsWith('\n')) chunk = seamPrefix + chunk;
            }
            streamed += chunk;
            appendToAssistant(assistantId, chunk);
          }
        } catch (e) {}
      }
    }

    settle();
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
      setIsAccountBound(true);
      setTempKeyInput('');
      setShowAuthModal(false);
      await fetchModels();
    } catch (error: any) {
      setAccountError(error?.message || '绑定失败');
    } finally {
      setAccountSaving(false);
    }
  };

  const disconnectAccount = async () => {
    await fetch('/api/account', { method: 'DELETE' });
    setIsAccountBound(false);
    setTempKeyInput('');
    setShowAuthModal(false);
    setSessions([]);
    createNewSession();
    await fetchModels();
  };

  const addIngestedFiles = async (files: FileList | File[]) => {
    setAttachError('');
    const { attachments: next, errors } = await ingestFiles(files);
    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...next]);
      // Do not auto-open the Context panel — attachments already show above the input.
    }
    if (errors.length > 0) setAttachError(errors.join(' · '));
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

  // Close model menu on outside click / Escape.
  useEffect(() => {
    if (!isModelMenuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (modelMenuRef.current && target && !modelMenuRef.current.contains(target)) {
        setIsModelMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsModelMenuOpen(false);
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

  // When images appear on a text-only model, warn — do not silently jump models.
  useEffect(() => {
    if (hasImages && !selectedSpec.vision) {
      setAttachError('This conversation has images. Pick a Vision model to continue.');
      return;
    }
    setAttachError((prev) =>
      prev === 'This conversation has images. Pick a Vision model to continue.' ? '' : prev,
    );
  }, [hasImages, selectedSpec.vision]);

  // Token estimate aligned with what the server actually sends.
  const contextBreakdown = useMemo(() => {
    const systemText = (systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT);
    const system = estimateTokensFromText(systemText);
    const reference = estimateTokensFromText(referenceText);
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
      reference,
      files,
      images: imageTokens,
      conversation,
      total: system + reference + files + imageTokens + conversation,
    };
  }, [messages, systemPrompt, referenceText, attachments]);

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
      });
      const data = await res.json();
      if (data?.success && Array.isArray(data.models)) {
        setAvailableModels(data.models);
        if (data.models.length > 0) {
          const saved =
            typeof window !== 'undefined'
              ? localStorage.getItem('llm_christmas_selected_model') || ''
              : '';
          setSelectedModel((prev) => {
            // Prefer in-memory selection, then last saved choice, else first model.
            const preferred = prev || saved;
            const exists = data.models.find((m: ModelOption) => m.id === preferred);
            return exists ? preferred : data.models[0].id;
          });
        } else {
          setSelectedModel('');
        }
      }
    } catch (e) {
      console.error('Failed to fetch models', e);
    } finally {
      setModelsLoading(false);
    }
  };

  // Remember the user's model choice across refreshes.
  useEffect(() => {
    if (!selectedModel) return;
    localStorage.setItem('llm_christmas_selected_model', selectedModel);
  }, [selectedModel]);

  // --- Chat Logic ---
  // Auto-drain the queue only when idle and not paused (Stop freezes the queue).
  useEffect(() => {
    if (!isLoading && !queuePaused && messageQueue.length > 0) {
      const nextTask = messageQueue[0];
      setMessageQueue((prev) => prev.slice(1));
      handleSubmit(nextTask.content, nextTask.baseMessages);
    }
  }, [isLoading, messageQueue, queuePaused]);

  const enqueueOrSubmit = (overrideInput?: string, baseMessagesOverride?: Message[]) => {
    const textToSend = overrideInput || input;
    const hasPending = attachments.length > 0;
    if (!textToSend.trim() && !hasPending) return;

    if (isLoading) {
      if (!textToSend.trim()) return;
      const now = Date.now();
      const lastInQueue = messageQueue[messageQueue.length - 1];
      if (lastInQueue && lastInQueue.content === textToSend.trim() && now - lastInQueue.enqueueTime < 500) {
        return;
      }
      setMessageQueue((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          content: textToSend.trim(),
          baseMessages: baseMessagesOverride,
          enqueueTime: now,
        },
      ]);
      setInput('');
      return;
    }

    handleSubmit(textToSend, baseMessagesOverride);
  };

  const cancelQueuedMessage = (id: string) => {
    setMessageQueue((prev) => {
      const next = prev.filter((task) => task.id !== id);
      if (next.length === 0) setQueuePaused(false);
      return next;
    });
  };

  const clearQueue = () => {
    setMessageQueue([]);
    setQueuePaused(false);
  };

  const resumeQueue = () => {
    setQueuePaused(false);
  };

  const jumpQueueAndSubmit = (id: string) => {
    const task = messageQueue.find((item) => item.id === id);
    if (!task) return;
    setMessageQueue((prev) => prev.filter((item) => item.id !== id));
    // Send Now is an explicit action — abort current reply without freezing the rest.
    if (isLoading) stopGenerating({ pauseQueue: false });
    setQueuePaused(false);
    setTimeout(() => {
      handleSubmit(task.content, task.baseMessages, true);
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
          messages: toApiMessages(older),
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

  const handleSubmit = async (overrideInput?: string, baseMessagesOverride?: Message[], force: boolean = false) => {
    const textToSend = overrideInput || input;
    const pendingImages = attachments.filter((a) => a.dataUrl);
    const pendingTexts = attachments.filter((a) => a.text);
    if ((!textToSend.trim() && pendingImages.length === 0 && pendingTexts.length === 0) || (!force && isLoading)) {
      return;
    }
    if (hasImages && !selectedSpec.vision) {
      setAttachError('This conversation has images — switch to a vision-capable model.');
      return;
    }

    stickToBottomRef.current = true;
    scrollToBottom(true);

    let fullContent = textToSend.trim();
    if (pendingTexts.length > 0) {
      const contextParts = pendingTexts.map(
        (a) => `[Attached File: ${a.name}]\n${a.text!.trim()}`,
      );
      fullContent = contextParts.join('\n\n') + (fullContent ? `\n\n---\n\n${fullContent}` : '');
    }

    const cleanedBase = (baseMessagesOverride ?? messages).filter(
      (m, idx, arr) => !(idx === arr.length - 1 && m.role === 'assistant' && m.incomplete && !m.content),
    );

    let baseMessages = cleanedBase;
    let newTitle = activeSession?.title;
    if (baseMessages.length === 0) {
      newTitle = (textToSend || pendingImages[0]?.name || 'New Conversation').slice(0, 30)
        + ((textToSend.length > 30) ? '...' : '');
    }

    // Compact before sending when the thread is near the model window.
    if (usableLimit != null && estimatedTokens + estimateTokensFromText(fullContent) > usableLimit * 0.9) {
      const compacted = await runCompact(baseMessages);
      if (!compacted) {
        setAttachError('Context is full. Compact failed — open a new chat or remove attachments.');
        return;
      }
      baseMessages = compacted;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: fullContent || (pendingImages.length ? '(image)' : ''),
      timestamp: Date.now(),
      images: pendingImages.map((a) => ({ url: a.dataUrl!, name: a.name })),
    };

    const newMessages = [...baseMessages, userMessage];
    updateActiveSession(newMessages, newTitle);
    setInput('');
    attachments.forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    });
    setAttachments([]);
    setIsLoading(true);
    setIsWaitingForFirstToken(true);

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      incomplete: true,
    };
    updateActiveSession([...newMessages, assistantMessage], newTitle);

    abortControllerRef.current = new AbortController();

    try {
      await streamChatResponse(
        toApiMessages(newMessages),
        assistantMessage.id,
        abortControllerRef.current.signal,
      );
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setIsWaitingForFirstToken(false);
        updateActiveSession([
          ...newMessages,
          {
            id: assistantMessage.id,
            role: 'assistant',
            content: `Error: ${error.message || 'Request failed'}`,
            timestamp: Date.now(),
            incomplete: false,
          },
        ]);
      } else {
        markAssistantIncomplete(assistantMessage.id, true, {
          truncationReason: 'Reply was interrupted',
        });
      }
    } finally {
      setIsLoading(false);
      setIsWaitingForFirstToken(false);
      abortControllerRef.current = null;
    }
  };

  const resumeIncompleteReply = async () => {
    const last = messages[messages.length - 1];
    if (isLoading || !last || last.role !== 'assistant' || !last.content.trim()) return;
    // Refuse to continue a reply that looks complete — matches the visible gate.
    const verdict = analyzeTruncation(
      last.content,
      last.finishReason,
      last.incomplete,
      last.truncationReason,
    );
    if (!verdict.truncated) return;

    stickToBottomRef.current = true;
    scrollToBottom(true);
    setIsLoading(true);
    setIsWaitingForFirstToken(true);

    abortControllerRef.current = new AbortController();

    const apiMessages: ReturnType<typeof toApiMessages> = [
      ...toApiMessages(messages),
      { role: 'user', content: buildContinuationPrompt(last.content), images: [] },
    ];

    // A finished table row must not be continued on the same line.
    const tail = last.content.trimEnd();
    const lastLine = tail.split('\n').pop() ?? '';
    const seamPrefix = /^\s*\|.*\|\s*$/.test(lastLine) ? '\n' : '';

    try {
      await streamChatResponse(
        apiMessages,
        last.id,
        abortControllerRef.current.signal,
        last.content,
        seamPrefix,
      );
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        // Replace the partial reply with a clean Error: bubble so Retry appears.
        updateActiveSession([
          ...messages.slice(0, -1),
          {
            id: last.id,
            role: 'assistant',
            content: `Error: ${error.message || 'Request failed'}`,
            timestamp: Date.now(),
            incomplete: false,
          },
        ]);
      } else {
        markAssistantIncomplete(last.id, true, {
          truncationReason: 'Stopped by you',
        });
      }
    } finally {
      setIsLoading(false);
      setIsWaitingForFirstToken(false);
      abortControllerRef.current = null;
    }
  };

  /** Drop the Error: assistant bubble and re-run the same user turn. */
  const retryFailedReply = async () => {
    const last = messages[messages.length - 1];
    if (isLoading || !isAssistantError(last)) return;
    const prior = messages.slice(0, -1);
    const lastUser = [...prior].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;

    stickToBottomRef.current = true;
    scrollToBottom(true);
    setIsLoading(true);
    setIsWaitingForFirstToken(true);

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      incomplete: true,
    };
    updateActiveSession([...prior, assistantMessage]);

    abortControllerRef.current = new AbortController();
    try {
      await streamChatResponse(
        toApiMessages(prior),
        assistantMessage.id,
        abortControllerRef.current.signal,
      );
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setIsWaitingForFirstToken(false);
        updateActiveSession([
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
        markAssistantIncomplete(assistantMessage.id, true, {
          truncationReason: 'Reply was interrupted',
        });
      }
    } finally {
      setIsLoading(false);
      setIsWaitingForFirstToken(false);
      abortControllerRef.current = null;
    }
  };

  const editUserMessage = (message: Message) => {
    if (isLoading) return;
    setEditingMessageId(message.id);
    setEditingMessageContent(message.content);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingMessageContent('');
  };

  const saveEditedMessage = async (messageId: string) => {
    const content = editingMessageContent.trim();
    if (!content || isLoading) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const priorMessages = messages.slice(0, index);
    setEditingMessageId(null);
    setEditingMessageContent('');
    
    if (isLoading) {
      stopGenerating();
      setTimeout(() => {
        handleSubmit(content, priorMessages);
      }, 50);
    } else {
      await handleSubmit(content, priorMessages);
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

  const stopGenerating = (opts?: { pauseQueue?: boolean }) => {
    const pauseQueue = opts?.pauseQueue ?? true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      setIsWaitingForFirstToken(false);
    }
    // Keep the half-written assistant reply resumable after stop/refresh.
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') {
      markAssistantIncomplete(last.id, true, {
        truncationReason: 'Stopped by you',
      });
    }
    // Stopping mid-reply should freeze remaining queued messages, not flush them.
    if (pauseQueue) setQueuePaused(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Prevent holding down Enter to spawn dozens of identical tasks
      if (e.repeat) return;
      enqueueOrSubmit();
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
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500 text-white shadow-sm">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  llm.christmas Chat
                </div>
              </div>

              <Button 
                onClick={createNewSession}
                className="w-full justify-start gap-2 bg-white text-stone-700 hover:bg-stone-50 border border-stone-200 shadow-sm dark:bg-stone-800 dark:text-stone-200 dark:border-stone-700 dark:hover:bg-stone-700"
              >
                <Plus className="h-4 w-4" />
                New Chat
              </Button>
            </div>

            <ScrollArea className="flex-1 px-3 py-2">
              <div className="space-y-1">
                {sidebarSessions.map(session => (
                  <div key={session.id} className="relative group">
                    <div
                      onClick={() => setActiveSessionId(session.id)}
                      className={cn(
                        "flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                        activeSessionId === session.id 
                          ? "bg-white text-stone-900 shadow-sm border border-stone-200 dark:bg-stone-800 dark:text-stone-100 dark:border-stone-700" 
                          : "text-stone-600 hover:bg-stone-200/50 dark:text-stone-400 dark:hover:bg-stone-800/50"
                      )}
                    >
                      <div className="flex items-center gap-2 overflow-hidden w-full pr-6">
                        <MessageSquare className="h-4 w-4 shrink-0 opacity-50" />
                        <span className="truncate">{session.title}</span>
                      </div>
                    </div>
                    
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSessionMenuOpenId(sessionMenuOpenId === session.id ? null : session.id);
                      }}
                      className={cn(
                        "absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md bg-transparent hover:bg-stone-200 dark:hover:bg-stone-700 transition-opacity",
                        sessionMenuOpenId === session.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      )}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5 text-stone-500" />
                    </button>

                    <AnimatePresence>
                      {sessionMenuOpenId === session.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl dark:border-stone-700 dark:bg-stone-900"
                        >
                          <div className="px-2 py-1.5 border-b border-stone-100 dark:border-stone-800/50 mb-1 flex items-center gap-2 text-xs text-stone-400">
                            <Clock className="h-3 w-3" />
                            {new Date(session.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </div>
                          
                          <div className="px-2 py-1 text-xs text-stone-500">
                            {session.messages.length} messages
                          </div>

                          <button
                            onClick={(e) => exportChat(session.id, e)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100 rounded-md dark:text-stone-300 dark:hover:bg-stone-800"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Export Markdown
                          </button>

                          <button
                            onClick={(e) => {
                              deleteSession(session.id, e);
                              setSessionMenuOpenId(null);
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md dark:text-red-400 dark:hover:bg-red-900/20"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete Chat
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </ScrollArea>
              
              {/* Sidebar Footer: Account & Quota Share */}
              <div className="p-3 border-t border-stone-200/60 dark:border-stone-800/60 bg-stone-100/80 dark:bg-stone-900/80">
                <button 
                  onClick={() => setShowAuthModal(true)}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-700/80 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-white", isAccountBound ? "bg-orange-500" : "bg-stone-400")}>
                      <Key className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">
                        {isAccountBound ? '主站账号已连接' : '连接 llm.christmas 账号'}
                      </div>
                      <div className="text-[10px] text-stone-400 truncate">
                        {isAccountBound ? '自动使用主站账号额度' : '登录一次，无需复制 API Key'}
                      </div>
                    </div>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
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

          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setIsContextPanelOpen(!isContextPanelOpen)}
              className={cn("text-xs gap-1.5", isContextPanelOpen ? "bg-stone-200/50 dark:bg-stone-800 text-stone-900 dark:text-stone-100" : "text-stone-500")}
            >
              {isContextPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              Context
            </Button>
            <a 
              href="https://llm.christmas" 
              target="_blank" 
              rel="noreferrer"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-medium text-stone-600 shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400"
            >
              <Wallet className="h-3.5 w-3.5 text-orange-500" />
              <span>Main Portal</span>
            </a>
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
          <div className="mx-auto w-full max-w-[960px] px-5 py-8 md:px-8 lg:px-10">
            {messages.length === 0 ? (
              <div className="mt-16 flex flex-col items-center text-center">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 shadow-sm dark:bg-orange-900/30 dark:text-orange-400">
                  <Sparkles className="h-7 w-7" />
                </div>
                <h2 className="mb-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
                  Universal AI at llm.christmas
                </h2>
                <p className="text-stone-500 max-w-md text-sm">
                  Connected directly to llm.christmas gateway.
                </p>

                <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 w-full max-w-2xl mx-auto">
                  {['Write a TypeScript API endpoint', 'Explain impermanent loss in DeFi', 'Refactor Python code for async', 'Draft a pitch for a Web3 product'].map(hint => (
                    <button 
                      key={hint}
                      onClick={() => handleSubmit(hint)}
                      className="rounded-xl border border-stone-200/80 bg-white p-4 text-left text-sm text-stone-700 transition-all hover:border-orange-300 hover:shadow-md dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-700"
                    >
                      <div className="font-medium">{hint}</div>
                      <div className="mt-1 text-xs text-stone-400">Click to ask &rarr;</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-8 pb-20">
                {messages.map((message) =>
                  message.role === 'user' ? (
                    <div key={message.id} className="group flex w-full justify-end">
                      <div className="max-w-[82%] sm:max-w-[72%]">
                        {editingMessageId === message.id ? (
                          <div className="rounded-2xl border border-orange-300 bg-white p-3 shadow-sm dark:border-orange-800 dark:bg-stone-900 w-full">
                            <Textarea
                              value={editingMessageContent}
                              onChange={(event) => setEditingMessageContent(event.target.value)}
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
                                className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600"
                              >
                                Save & resend
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="rounded-2xl rounded-br-md bg-stone-200/80 px-4 py-3 text-[15px] leading-7 text-stone-900 dark:bg-stone-800 dark:text-stone-100 whitespace-pre-wrap">
                              {message.images && message.images.length > 0 && (
                                <div className="mb-2 flex flex-wrap gap-2">
                                  {message.images.map((img, idx) => (
                                    <img
                                      key={idx}
                                      src={img.url}
                                      alt={img.name || 'attachment'}
                                      className="max-h-48 max-w-full rounded-lg object-contain"
                                    />
                                  ))}
                                </div>
                              )}
                              {message.content && message.content !== '(image)' ? message.content : null}
                            </div>
                            <div className="mt-1 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => editUserMessage(message)}
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
                      {message.reasoning && (
                        <div className="rounded-xl border border-stone-200/80 bg-stone-50/80 dark:border-stone-800 dark:bg-stone-900/50 overflow-hidden">
                          <button
                            type="button"
                            onClick={() =>
                              setReasoningOpen((prev) => ({
                                ...prev,
                                [message.id]: !(
                                  prev[message.id] ??
                                  Boolean(message.incomplete && !message.content)
                                ),
                              }))
                            }
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-stone-500 hover:bg-stone-100/80 dark:text-stone-400 dark:hover:bg-stone-800/50"
                          >
                            <ChevronDown
                              className={cn(
                                'h-3.5 w-3.5 shrink-0 transition-transform',
                                (reasoningOpen[message.id] ??
                                  Boolean(message.incomplete && !message.content))
                                  ? 'rotate-0'
                                  : '-rotate-90',
                              )}
                            />
                            <span>
                              {message.incomplete && !message.content
                                ? 'Thinking…'
                                : 'Thought process'}
                            </span>
                            {message.incomplete && !message.content && (
                              <span className="ml-auto flex items-center gap-1">
                                <span className="h-1 w-1 animate-pulse rounded-full bg-orange-500" />
                                <span className="h-1 w-1 animate-pulse rounded-full bg-orange-500 [animation-delay:150ms]" />
                                <span className="h-1 w-1 animate-pulse rounded-full bg-orange-500 [animation-delay:300ms]" />
                              </span>
                            )}
                          </button>
                          {(reasoningOpen[message.id] ??
                            Boolean(message.incomplete && !message.content)) && (
                            <div className="border-t border-stone-200/70 px-3 py-2.5 text-[13px] leading-6 text-stone-500 whitespace-pre-wrap dark:border-stone-800 dark:text-stone-400 max-h-72 overflow-y-auto">
                              {message.reasoning}
                            </div>
                          )}
                        </div>
                      )}
                      {(message.content || (!message.reasoning && message.incomplete)) && (
                        isAssistantError(message) ? (
                          <div className="rounded-xl border border-red-200 bg-red-50/80 px-3.5 py-3 dark:border-red-900/50 dark:bg-red-950/30">
                            <p className="text-sm font-medium text-red-700 dark:text-red-300">
                              Request failed
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-red-600/90 dark:text-red-400/90">
                              {message.content.replace(/^Error:\s*/, '')}
                            </p>
                            {message.id === lastMessage?.id && canRetryFailed && (
                              <button
                                type="button"
                                onClick={() => retryFailedReply()}
                                className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                              >
                                <RefreshCw className="h-3 w-3" />
                                Retry
                              </button>
                            )}
                          </div>
                        ) : (
                      <div className="chat-markdown w-full text-stone-800 dark:text-stone-200 leading-relaxed text-[15px]">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
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
                            blockquote({ children }: any) {
                              return (
                                <blockquote className="my-4 border-l-4 border-stone-300 pl-4 italic text-stone-600 dark:border-stone-700 dark:text-stone-400">
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
                            code({ node, inline, className, children, ...props }: any) {
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
                          {normalizeMathDelimiters(message.content)}
                        </ReactMarkdown>
                      </div>
                        )
                      )}
                    </div>
                  ),
                )}

                {/* Waiting dots only when nothing has streamed yet (no reasoning, no content). */}
                {isWaitingForFirstToken && !(messages[messages.length - 1]?.reasoning) && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full pr-8 sm:pr-16 flex items-center gap-2 text-stone-400 dark:text-stone-500"
                  >
                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800/50 shadow-sm w-fit">
                      <motion.div
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                        className="w-1.5 h-1.5 rounded-full bg-orange-500"
                      />
                      <motion.div
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
                        className="w-1.5 h-1.5 rounded-full bg-orange-500"
                      />
                      <motion.div
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
                        className="w-1.5 h-1.5 rounded-full bg-orange-500"
                      />
                    </div>
                  </motion.div>
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
              {messageQueue.length > 0 && (
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
                        {messageQueue.length} queued
                      </span>
                      {queuePaused && (
                        <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          Paused
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
                          Continue
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={clearQueue}
                        className="rounded-lg px-2 py-1 text-xs text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
                      >
                        Clear
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
                          {messageQueue.map((task, idx) => (
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

            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <div
                    key={a.id}
                    className="group flex max-w-full items-center gap-2 rounded-xl border border-stone-200 bg-white px-2 py-1.5 text-xs shadow-sm dark:border-stone-700 dark:bg-stone-900"
                  >
                    {a.previewUrl || a.dataUrl ? (
                      <img
                        src={a.previewUrl || a.dataUrl}
                        alt=""
                        className="h-8 w-8 rounded object-cover"
                      />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                    )}
                    <span className="truncate text-stone-600 dark:text-stone-300">{a.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-red-500 dark:hover:bg-stone-800"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Continue / Retry — sit above the composer as recovery actions. */}
            <AnimatePresence>
              {(canResumeIncomplete || canRetryFailed) && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="mb-2 flex justify-center"
                >
                  {canRetryFailed ? (
                    <button
                      type="button"
                      onClick={() => retryFailedReply()}
                      title="Retry the last request"
                      className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3.5 py-1.5 text-xs font-medium text-red-800 shadow-sm transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-950/80"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Retry
                      <span className="hidden sm:inline font-normal text-red-600/80 dark:text-red-400/70">
                        · Request failed
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => resumeIncompleteReply()}
                      title={truncationInfo.reason || 'Continue the previous reply'}
                      className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3.5 py-1.5 text-xs font-medium text-amber-800 shadow-sm transition-colors hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-950/80"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      Continue
                      {truncationInfo.reason && (
                        <span className="hidden sm:inline font-normal text-amber-600/80 dark:text-amber-400/70">
                          · {truncationInfo.reason}
                        </span>
                      )}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex flex-col rounded-2xl border border-stone-300 bg-white shadow-sm focus-within:ring-2 focus-within:ring-orange-500/20 focus-within:border-orange-500 dark:border-stone-700 dark:bg-stone-900 transition-all">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={onPasteFiles}
                placeholder={`Ask ${selectedModel || 'anything'}…  (drop or paste files here)`}
                className="min-h-[60px] max-h-[300px] w-full resize-none border-0 bg-transparent px-4 py-4 text-base focus-visible:ring-0 placeholder:text-stone-400"
              />
              
              <div className="flex items-center justify-between px-3 pb-3 pt-1">
                <div className="flex items-center gap-2">
                  <div className="relative" ref={modelMenuRef}>
                    <button 
                      onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                      className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg hover:bg-stone-100 text-xs font-medium text-stone-600 transition-colors dark:text-stone-400 dark:hover:bg-stone-800"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                      <span className="truncate max-w-[140px] sm:max-w-[200px] text-left">
                        {modelsLoading 
                          ? 'Loading models…' 
                          : (availableModels.find(m => m.id === selectedModel)?.id || selectedModel || 'Select Model')}
                      </span>
                      <ChevronDown className="h-3 w-3 text-stone-400" />
                    </button>

                    <AnimatePresence>
                      {isModelMenuOpen && (
                        <motion.div 
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 5 }}
                          className="absolute left-0 bottom-10 mb-2 z-30 w-[280px] sm:w-80 max-h-[400px] overflow-y-auto rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl dark:border-stone-700 dark:bg-stone-900"
                        >
                          <div className="px-2 py-1 flex items-center justify-between sticky top-0 bg-inherit pb-2 border-b border-stone-100 dark:border-stone-800/50 mb-1">
                            <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">
                              {isAccountBound ? 'All Models' : 'Free Models'}
                            </span>
                            <span className="text-[10px] text-stone-400">
                              {availableModels.length} models
                            </span>
                          </div>
                          {availableModels.length === 0 && !modelsLoading && (
                            <div className="p-4 text-xs text-stone-400 text-center">
                              {isAccountBound ? 'No models found. Check connection.' : 'No free models available.'}
                            </div>
                          )}
                          {modelsLoading && availableModels.length === 0 && (
                            <div className="p-4 text-xs text-stone-400 text-center">
                              Loading...
                            </div>
                          )}
                          {availableModels.map(m => {
                            const blocked = hasImages && !m.vision;
                            return (
                            <button
                              key={m.id}
                              disabled={blocked}
                              onClick={() => {
                                if (blocked) return;
                                setSelectedModel(m.id);
                                setIsModelMenuOpen(false);
                              }}
                              className={cn(
                                "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left gap-2",
                                blocked && "opacity-40 cursor-not-allowed",
                                selectedModel === m.id 
                                  ? "bg-orange-50 text-orange-900 font-medium dark:bg-orange-950/40 dark:text-orange-300" 
                                  : "hover:bg-stone-100 text-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                              )}
                              title={blocked ? 'Text-only — this conversation has images' : undefined}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate">{m.id}</div>
                                {blocked && (
                                  <div className="text-[10px] text-stone-400">Text-only · needs vision</div>
                                )}
                              </div>
                              {m.vision && (
                                <span className="text-[9px] font-semibold tracking-wide rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-stone-500 shrink-0 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400">
                                  Vision
                                </span>
                              )}
                              {m.tier === 'paid' ? (
                                <span className="text-[9px] font-semibold tracking-wide rounded bg-orange-500 px-1.5 py-0.5 text-white shrink-0">
                                  Pro
                                </span>
                              ) : (
                                <span className="text-[9px] font-semibold tracking-wide rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-orange-700 shrink-0 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-300">
                                  Free
                                </span>
                              )}
                              {selectedModel === m.id && <Check className="h-4 w-4 text-orange-500 shrink-0 ml-1" />}
                            </button>
                            );
                          })}
                          {!isAccountBound && (
                            <div className="mt-1 pt-2 border-t border-stone-100 dark:border-stone-800 p-2">
                              <button 
                                onClick={() => { setIsModelMenuOpen(false); setShowAuthModal(true); }}
                                className="w-full text-xs text-center text-orange-600 hover:underline font-medium"
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
                  {isLoading ? (
                    <Button 
                      onClick={() => stopGenerating()}
                      size="icon" 
                      title="Stop"
                      className="h-8 w-8 rounded-full bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:text-stone-900"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                    </Button>
                  ) : (
                    <Button 
                      onClick={() => enqueueOrSubmit()}
                      disabled={(!input.trim() && attachments.length === 0) || isCompacting}
                      size="icon" 
                      title="Send"
                      className={cn(
                        "h-8 w-8 rounded-full transition-all active:scale-95",
                        (input.trim() || attachments.length > 0)
                          ? "bg-orange-500 hover:bg-orange-600 text-white shadow-sm" 
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
                  <div className="space-y-6">
                    
                    <div className="space-y-3">
                      <label className="text-xs font-semibold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" /> 
                        Attachments ({attachments.length})
                      </label>
                      {attachments.length === 0 ? (
                        <div className="text-xs text-stone-400 py-2">
                          Drop files onto the chat, or paste images with Ctrl/Cmd+V. Supports images, PDF, Word, and text.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {attachments.map(a => (
                            <div key={a.id} className="group flex items-center justify-between p-2 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/50 text-xs">
                              <div className="min-w-0 flex-1 flex items-center gap-2">
                                {a.previewUrl ? (
                                  <div className="h-8 w-8 shrink-0 rounded bg-stone-200 overflow-hidden">
                                    <img src={a.previewUrl} alt="preview" className="h-full w-full object-cover" />
                                  </div>
                                ) : (
                                  <FileText className="h-4 w-4 shrink-0 text-stone-400" />
                                )}
                                <div className="truncate text-stone-600 dark:text-stone-300">{a.name}</div>
                              </div>
                              <button onClick={() => removeAttachment(a.id)} className="p-1 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
                          <Quote className="h-3.5 w-3.5" /> 
                          Reference Material
                        </label>
                        {referenceText.trim() && (
                          <button
                            type="button"
                            onClick={() => setReferenceText('')}
                            className="text-[10px] text-stone-400 hover:text-red-500"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed text-stone-400">
                        Background the model should treat as fact. Sent with every message in this chat.
                      </p>
                      <Textarea
                        value={referenceText}
                        onChange={e => setReferenceText(e.target.value)}
                        placeholder="Paste context, docs, or background info here..."
                        className="min-h-24 text-xs font-mono bg-stone-50 dark:bg-stone-900/50 border-stone-200 dark:border-stone-800"
                      />
                      {referenceText.trim() && (
                        <div className="text-[10px] text-stone-400 text-right font-mono">
                          ~{contextBreakdown.reference.toLocaleString()} tokens
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
                          <Settings2 className="h-3.5 w-3.5" /> 
                          System Prompt
                        </label>
                        {systemPrompt.trim() && (
                          <button
                            type="button"
                            onClick={() => setSystemPrompt('')}
                            className="text-[10px] text-stone-400 hover:text-red-500"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed text-stone-400">
                        Standing instructions for tone, language, and role. Leave empty to use the default assistant.
                      </p>
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
                        onChange={e => setSystemPrompt(e.target.value)}
                        placeholder="You are a helpful AI..."
                        className="min-h-24 text-xs bg-stone-50 dark:bg-stone-900/50 border-stone-200 dark:border-stone-800"
                      />
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
                    <span className="font-mono text-stone-700 dark:text-stone-300">
                      {contextLimit != null ? contextLimit.toLocaleString() : 'unknown'}
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

      {/* --- Key / Auth Modal --- */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl dark:border-stone-800 dark:bg-stone-900"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 font-semibold text-lg">
                  <Key className="h-5 w-5 text-orange-500" />
                  Connect llm.christmas Account
                </div>
                <button onClick={() => setShowAuthModal(false)} className="text-stone-400 hover:text-stone-600">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <p className="text-sm text-stone-500 mb-4">
                {isAccountBound
                  ? 'Your llm.christmas account is connected. Balance and paid-model access are shared automatically.'
                  : 'Sign in on the main site and authorize Chat. Your balance and paid-model access will be shared automatically.'}
              </p>

              <div className="space-y-4">
                {isAccountBound ? (
                  <Button
                    variant="outline"
                    onClick={disconnectAccount}
                    className="w-full rounded-xl border-red-200 text-red-600 hover:bg-red-50"
                  >
                    Disconnect
                  </Button>
                ) : (
                  <>
                    <a
                      href="/api/auth/start"
                      className="flex h-11 w-full items-center justify-center rounded-xl bg-orange-500 font-semibold text-white hover:bg-orange-600"
                    >
                      Continue with llm.christmas
                    </a>

                    <div className="flex items-center gap-3 text-xs text-stone-400">
                      <span className="h-px flex-1 bg-stone-200 dark:bg-stone-700" />
                      Manual API Key fallback
                      <span className="h-px flex-1 bg-stone-200 dark:bg-stone-700" />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                        API Token (sk-...)
                      </label>
                      <input
                        type="password"
                        value={tempKeyInput}
                        onChange={(e) => setTempKeyInput(e.target.value)}
                        placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full rounded-xl border border-stone-300 p-3 text-sm focus:border-orange-500 focus:outline-none dark:border-stone-700 dark:bg-stone-800"
                      />
                    </div>

                    {accountError && (
                      <p className="text-sm text-red-600 dark:text-red-400">{accountError}</p>
                    )}

                    <Button
                      onClick={saveUserKey}
                      disabled={accountSaving || !tempKeyInput.trim()}
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-xl"
                    >
                      {accountSaving ? 'Validating…' : 'Save & Connect'}
                    </Button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}