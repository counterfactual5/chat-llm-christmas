'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, Bot, User, Loader2, RefreshCw, Copy, Check, Trash2, 
  Menu, Plus, MessageSquare, Settings2, Image as ImageIcon, 
  Mic, Square, Download, Key, Sparkles, ChevronDown, Wallet, LogOut, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './markdown/code-block';

// --- Types ---
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
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
}

export default function ChatContainer() {
  // State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
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
  const [temperature, setTemperature] = useState(0.7);
  const [isListening, setIsListening] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load Saved State
  useEffect(() => {
    // Migrate away from the old insecure client-side key storage.
    localStorage.removeItem('llm_christmas_user_key');

    const savedChats = localStorage.getItem('llm_christmas_chats');
    if (savedChats) {
      try {
        const parsed = JSON.parse(savedChats) as ChatSession[];
        // Clean up drafts created by older versions: retain at most one blank chat.
        const nonEmpty = parsed.filter((session) => session.messages?.length > 0);
        const firstEmpty = parsed.find((session) => !session.messages?.length);
        const normalized = firstEmpty ? [...nonEmpty, firstEmpty] : nonEmpty;
        if (normalized.length > 0) {
          setSessions(normalized);
          setActiveSessionId(normalized[0].id);
        } else {
          createNewSession();
        }
      } catch (e) { createNewSession(); }
    } else {
      createNewSession();
    }

    // Detect whether a personal API key is already bound in the HttpOnly cookie.
    fetch('/api/account', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        const bound = Boolean(data?.bound);
        setIsAccountBound(bound);
        fetchModels();
      })
      .catch(() => fetchModels());
  }, []);

  // Save Sessions
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('llm_christmas_chats', JSON.stringify(sessions));
    }
  }, [sessions]);

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const messages = activeSession?.messages || [];

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // --- Actions ---
  const createNewSession = () => {
    // Reuse an existing empty draft instead of accumulating blank conversations.
    const emptyDraft = sessions.find((session) => session.messages.length === 0);
    if (emptyDraft) {
      setActiveSessionId(emptyDraft.id);
      if (window.innerWidth < 768) setIsSidebarOpen(false);
      return;
    }

    const newSession: ChatSession = {
      id: crypto.randomUUID(),
      title: 'New Conversation',
      messages: [],
      updatedAt: Date.now(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const updateActiveSession = (newMessages: Message[], title?: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return {
          ...s,
          messages: newMessages,
          title: title || s.title,
          updatedAt: Date.now(),
        };
      }
      return s;
    }));
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = sessions.filter(s => s.id !== id);

    // Keep exactly one empty draft when the final conversation is removed.
    if (filtered.length === 0) {
      const emptyDraft: ChatSession = {
        id: crypto.randomUUID(),
        title: 'New Conversation',
        messages: [],
        updatedAt: Date.now(),
      };
      setSessions([emptyDraft]);
      setActiveSessionId(emptyDraft.id);
      return;
    }

    setSessions(filtered);
    if (activeSessionId === id) setActiveSessionId(filtered[0].id);
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
    await fetchModels();
  };

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
        // Set default selected model: prefer first free or first available
        if (data.models.length > 0) {
          setSelectedModel(prev => {
            // Keep current selection if still valid
            const exists = data.models.find((m: ModelOption) => m.id === prev);
            return exists ? prev : data.models[0].id;
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

  // --- Chat Logic ---
  const handleSubmit = async (overrideInput?: string) => {
    const textToSend = overrideInput || input;
    if (!textToSend.trim() || isLoading) return;

    let newTitle = activeSession?.title;
    if (messages.length === 0) {
      newTitle = textToSend.slice(0, 30) + (textToSend.length > 30 ? '...' : '');
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: textToSend.trim(),
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    updateActiveSession(newMessages, newTitle);
    setInput('');
    setIsLoading(true);

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          model: selectedModel,
          temperature,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Upstream error');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };

      updateActiveSession([...newMessages, assistantMessage]);

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              setIsLoading(false);
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                setSessions(prev => prev.map(s => {
                  if (s.id === activeSessionId) {
                    const msgs = [...s.messages];
                    const last = msgs[msgs.length - 1];
                    if (last && last.id === assistantMessage.id) {
                      last.content += parsed.content;
                    }
                    return { ...s, messages: msgs };
                  }
                  return s;
                }));
              }
            } catch (e) {}
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        updateActiveSession([
          ...newMessages,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: `Error: ${error.message || 'Request failed'}`,
            timestamp: Date.now(),
          }
        ]);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const stopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#F9F8F6] font-sans text-stone-800 dark:bg-stone-950 dark:text-stone-200 overflow-hidden">
      
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
                <div className="flex items-center gap-2 font-bold text-base tracking-tight text-stone-900 dark:text-stone-100">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500 text-white shadow-sm">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  llm.christmas
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
                {sessions.map(session => (
                  <div
                    key={session.id}
                    onClick={() => setActiveSessionId(session.id)}
                    className={cn(
                      "group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                      activeSessionId === session.id 
                        ? "bg-white text-stone-900 shadow-sm border border-stone-200 dark:bg-stone-800 dark:text-stone-100 dark:border-stone-700" 
                        : "text-stone-600 hover:bg-stone-200/50 dark:text-stone-400 dark:hover:bg-stone-800/50"
                    )}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <MessageSquare className="h-4 w-4 shrink-0 opacity-50" />
                      <span className="truncate">{session.title}</span>
                    </div>
                    <button 
                      onClick={(e) => deleteSession(session.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-opacity"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
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
                  <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-white", isAccountBound ? "bg-emerald-500" : "bg-stone-400")}>
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
        
        {/* Header without Model Selector */}
        <header className="flex h-14 items-center justify-between px-4 border-b border-stone-200/50 dark:border-stone-800/50 bg-[#F9F8F6] dark:bg-stone-950 z-10 shrink-0">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(true)} className="text-stone-500 hover:bg-stone-200/50 dark:hover:bg-stone-800/50">
                <Menu className="h-5 w-5" />
              </Button>
            )}
            <span className="font-semibold text-stone-700 dark:text-stone-300">
              llm.christmas Chat
            </span>
          </div>

          <div className="flex items-center gap-2">
            <a 
              href="https://llm.christmas" 
              target="_blank" 
              rel="noreferrer"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-medium text-stone-600 shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400"
            >
              <Wallet className="h-3.5 w-3.5 text-emerald-500" />
              <span>Main Portal</span>
            </a>
          </div>
        </header>

        {/* Messages List */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" ref={scrollRef}>
          <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
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
                {messages.map((message) => (
                  <div key={message.id} className="group relative flex flex-col gap-2 mx-auto max-w-4xl">
                    {/* Header: Avatar + Name */}
                    <div className="flex items-center gap-3">
                      <div className="flex shrink-0">
                        {message.role === 'user' ? (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                            <User className="h-4 w-4" />
                          </div>
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500 text-white shadow-sm">
                            <Bot className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="font-semibold text-sm text-stone-900 dark:text-stone-100">
                        {message.role === 'user' ? 'You' : 'Assistant'}
                      </div>
                    </div>
                    
                    {/* Content */}
                    <div className="pl-10">
                      <div className="prose prose-stone dark:prose-invert max-w-none text-stone-800 dark:text-stone-200 leading-relaxed text-[15px]">
                        {message.role === 'assistant' ? (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              code({ node, inline, className, children, ...props }: any) {
                                const match = /language-(\w+)/.exec(className || '');
                                const value = String(children).replace(/\n$/, '');
                                if (!inline && match) {
                                  return <CodeBlock language={match[1]} value={value} />;
                                }
                                return (
                                  <code {...props} className="rounded bg-stone-200/50 px-1.5 py-0.5 text-sm dark:bg-stone-800">
                                    {children}
                                  </code>
                                );
                              },
                              pre({ children }: any) { return <>{children}</>; },
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        ) : (
                          <div className="whitespace-pre-wrap">{message.content}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Floating Input Area */}
        <div className="shrink-0 px-4 pb-6 pt-2 bg-gradient-to-t from-[#F9F8F6] via-[#F9F8F6] to-transparent dark:from-stone-950 dark:via-stone-950">
          <div className="mx-auto max-w-4xl relative">
            <div className="flex flex-col rounded-2xl border border-stone-300 bg-white shadow-sm focus-within:ring-2 focus-within:ring-orange-500/20 focus-within:border-orange-500 dark:border-stone-700 dark:bg-stone-900 transition-all">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask ${selectedModel}...`}
                className="min-h-[60px] max-h-[300px] w-full resize-none border-0 bg-transparent px-4 py-4 text-base focus-visible:ring-0 placeholder:text-stone-400"
                disabled={isLoading}
              />
              
              <div className="flex items-center justify-between px-3 pb-3 pt-1">
                <div className="flex items-center gap-2">
                  <div className="relative">
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
                          {availableModels.map(m => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setSelectedModel(m.id);
                                setIsModelMenuOpen(false);
                              }}
                              className={cn(
                                "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left gap-2",
                                selectedModel === m.id 
                                  ? "bg-orange-50 text-orange-900 font-medium dark:bg-orange-950/40 dark:text-orange-300" 
                                  : "hover:bg-stone-100 text-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate">{m.id}</div>
                              </div>
                              {m.tier === 'paid' ? (
                                <span className="text-[9px] font-bold tracking-wider bg-gradient-to-r from-amber-500 to-orange-500 text-white px-1.5 py-0.5 rounded shrink-0">PRO</span>
                              ) : (
                                <span className="text-[9px] font-bold tracking-wider bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded dark:bg-emerald-900/40 dark:text-emerald-300 shrink-0">FREE</span>
                              )}
                              {selectedModel === m.id && <Check className="h-4 w-4 text-orange-500 shrink-0 ml-1" />}
                            </button>
                          ))}
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
                      onClick={stopGenerating}
                      size="icon" 
                      className="h-8 w-8 rounded-full bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:text-stone-900"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                    </Button>
                  ) : (
                    <Button 
                      onClick={() => handleSubmit()}
                      disabled={!input.trim()}
                      size="icon" 
                      className={cn(
                        "h-8 w-8 rounded-full transition-all active:scale-95",
                        input.trim() 
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
                Sign in on the main site and authorize Chat. Your balance and paid-model access will be shared automatically.
              </p>

              <div className="space-y-4">
                {!isAccountBound && (
                  <a
                    href="/api/auth/start"
                    className="flex h-11 w-full items-center justify-center rounded-xl bg-orange-500 font-semibold text-white hover:bg-orange-600"
                  >
                    Continue with llm.christmas
                  </a>
                )}

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

                <div className="flex gap-2">
                  <Button 
                    onClick={saveUserKey}
                    disabled={accountSaving || !tempKeyInput.trim()}
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white rounded-xl"
                  >
                    {accountSaving ? 'Validating…' : 'Save & Connect'}
                  </Button>
                  {isAccountBound && (
                    <Button 
                      variant="outline"
                      onClick={disconnectAccount}
                      className="rounded-xl border-red-200 text-red-600 hover:bg-red-50"
                    >
                      Disconnect
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}