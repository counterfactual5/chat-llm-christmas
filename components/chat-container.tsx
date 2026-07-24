'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, Bot, User, Loader2, RefreshCw, Copy, Check, Trash2, 
  Menu, Plus, MessageSquare, Settings2, Image as ImageIcon, 
  Mic, Square, Download, Share, X
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

// --- Main Component ---
export default function ChatContainer() {
  // State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Settings State
  const [model, setModel] = useState('deepseek-v4-flash-200k');
  const [temperature, setTemperature] = useState(0.7);
  const [isListening, setIsListening] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize & Load from LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('llm_christmas_chats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) {
          setSessions(parsed);
          setActiveSessionId(parsed[0].id);
          return;
        }
      } catch (e) { console.error('Failed to parse chats', e); }
    }
    // Create default session if empty
    createNewSession();
  }, []);

  // Save to LocalStorage
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('llm_christmas_chats', JSON.stringify(sessions));
    }
  }, [sessions]);

  // Scroll to bottom
  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const messages = activeSession?.messages || [];

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // --- Actions ---
  const createNewSession = () => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
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
    setSessions(filtered);
    if (activeSessionId === id) {
      if (filtered.length > 0) setActiveSessionId(filtered[0].id);
      else createNewSession();
    }
  };

  // --- Chat Logic ---
  const handleSubmit = async (overrideInput?: string) => {
    const textToSend = overrideInput || input;
    if (!textToSend.trim() || isLoading) return;

    // Generate title for new chat
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
          model,
          temperature,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error(await response.text());
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
                    if (last.id === assistantMessage.id) {
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
      if (error.name === 'AbortError') {
        console.log('Aborted');
      } else {
        updateActiveSession([
          ...newMessages,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: `Error: ${error.message || 'Upstream request failed'}`,
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

  const regenerateLast = () => {
    if (messages.length === 0 || isLoading) return;
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      // Remove all messages after the last user message
      const idx = messages.findIndex(m => m.id === lastUserMsg.id);
      const trimmed = messages.slice(0, idx);
      updateActiveSession(trimmed);
      handleSubmit(lastUserMsg.content);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // --- Voice Input (Web Speech API) ---
  const toggleVoice = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in your browser.');
      return;
    }
    
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US'; // Could be made configurable
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0])
        .map((result) => result.transcript)
        .join('');
      setInput(prev => prev + ' ' + transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    
    recognition.start();
  };

  const exportChat = () => {
    if (!activeSession) return;
    const md = activeSession.messages.map(m => `### ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.content}\n`).join('\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSession.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
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
            className="h-full shrink-0 border-r border-stone-200 bg-stone-100/50 dark:border-stone-800 dark:bg-stone-900/50 flex flex-col"
          >
            <div className="p-4 flex gap-2">
              <Button 
                onClick={createNewSession}
                className="flex-1 justify-start gap-2 bg-white text-stone-700 hover:bg-stone-50 border border-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:border-stone-700 dark:hover:bg-stone-700"
              >
                <Plus className="h-4 w-4" />
                New Chat
              </Button>
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => setIsSidebarOpen(false)}
                className="md:hidden"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1 px-3">
              <div className="space-y-1 pb-4">
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Main Chat Area --- */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#F9F8F6] dark:bg-stone-950">
        
        {/* Header */}
        <header className="flex h-14 items-center justify-between px-4 border-b border-stone-200/50 dark:border-stone-800/50 bg-white/50 dark:bg-stone-900/50 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            {!isSidebarOpen && (
              <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(true)} className="text-stone-500">
                <Menu className="h-5 w-5" />
              </Button>
            )}
            <div className="font-medium text-stone-800 dark:text-stone-200">
              llm.christmas
            </div>
            <div className="hidden md:flex items-center ml-4 px-2 py-1 rounded-md bg-stone-200/50 dark:bg-stone-800 text-xs font-medium text-stone-500">
              {model}
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button variant="ghost" size="icon" onClick={exportChat} title="Export Markdown" className="text-stone-500 hidden sm:flex">
                <Download className="h-4 w-4" />
              </Button>
            )}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setShowSettings(!showSettings)}
              className={cn("text-stone-500", showSettings && "bg-stone-200 dark:bg-stone-800")}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Settings Dropdown */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute right-4 top-16 z-20 w-72 rounded-xl border border-stone-200 bg-white p-4 shadow-xl dark:border-stone-700 dark:bg-stone-900"
            >
              <h3 className="mb-4 text-sm font-medium">Model Settings</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs text-stone-500">Model</label>
                  <select 
                    value={model} 
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full rounded-md border border-stone-200 p-2 text-sm dark:border-stone-700 dark:bg-stone-800"
                  >
                    <option value="deepseek-v4-flash-200k">DeepSeek Flash</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-stone-500">
                    <label>Temperature</label>
                    <span>{temperature}</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" max="2" step="0.1" 
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full accent-stone-700"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages List */}
        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
            {messages.length === 0 ? (
              <div className="mt-20 flex flex-col items-center text-center">
                <div className="mb-6 rounded-2xl bg-stone-200/50 p-4 dark:bg-stone-800">
                  <Bot className="h-8 w-8 text-stone-600 dark:text-stone-400" />
                </div>
                <h2 className="mb-2 text-2xl font-semibold">How can I help you today?</h2>
                <p className="text-stone-500">Ask anything, or try an example below.</p>
                <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 w-full max-w-2xl">
                  {['Write a React component', 'Explain quantum computing', 'Analyze this data', 'Translate to Spanish'].map(hint => (
                    <button 
                      key={hint}
                      onClick={() => handleSubmit(hint)}
                      className="rounded-xl border border-stone-200 bg-white p-4 text-left text-sm text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800"
                    >
                      {hint} &rarr;
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-8 pb-20">
                {messages.map((message, idx) => (
                  <div key={message.id} className="group relative flex gap-4 md:gap-6">
                    {/* Avatar */}
                    <div className="flex shrink-0 mt-1">
                      {message.role === 'user' ? (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                          <User className="h-5 w-5" />
                        </div>
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-500">
                          <Bot className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium mb-1 text-sm text-stone-900 dark:text-stone-100">
                        {message.role === 'user' ? 'You' : 'Assistant'}
                      </div>
                      
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

                      {/* Message Actions */}
                      <div className="mt-2 flex opacity-0 group-hover:opacity-100 transition-opacity gap-2">
                        <button 
                          onClick={() => navigator.clipboard.writeText(message.content)}
                          className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                        >
                          <Copy className="h-3.5 w-3.5" /> Copy
                        </button>
                        {message.role === 'assistant' && idx === messages.length - 1 && (
                          <button 
                            onClick={regenerateLast}
                            className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Retry
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input Box - Floating bottom */}
        <div className="px-4 pb-6 pt-2 bg-gradient-to-t from-[#F9F8F6] via-[#F9F8F6] to-transparent dark:from-stone-950 dark:via-stone-950">
          <div className="mx-auto max-w-3xl relative">
            <div className="flex flex-col rounded-2xl border border-stone-300 bg-white shadow-sm focus-within:ring-2 focus-within:ring-stone-400/20 focus-within:border-stone-400 dark:border-stone-700 dark:bg-stone-900 transition-all">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                className="min-h-[60px] max-h-[400px] w-full resize-none border-0 bg-transparent px-4 py-4 text-base focus-visible:ring-0 placeholder:text-stone-400"
                disabled={isLoading}
                rows={1}
                style={{ height: 'auto', overflowY: 'hidden' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 400) + 'px';
                }}
              />
              
              <div className="flex items-center justify-between px-3 pb-3 pt-1">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" title="Attach file (UI Demo)">
                    <ImageIcon className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={toggleVoice}
                    className={cn("h-8 w-8 rounded-full", isListening ? "text-red-500 bg-red-50 dark:bg-red-900/20" : "text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800")}
                    title="Voice input"
                  >
                    <Mic className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="flex items-center gap-2">
                  {isLoading ? (
                    <Button 
                      onClick={stopGenerating}
                      size="icon" 
                      className="h-8 w-8 rounded-full bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white transition-transform active:scale-95"
                      title="Stop generating"
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
            <div className="mt-2 text-center text-xs text-stone-400">
              AI can make mistakes. Consider verifying important information.
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}