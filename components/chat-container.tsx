'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Bot, User, Loader2, RefreshCw, Copy, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import 'highlight.js/styles/atom-one-dark.css';
import { CodeBlock } from './markdown/code-block';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);

function highlightCode(code: string, language: string) {
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch (e) {
    return code;
  }
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export default function ChatContainer() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setIsTyping(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get response');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

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
              setIsTyping(false);
              setIsLoading(false);
              return;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, content: m.content + parsed.content }
                      : m
                  )
                );
              }
            } catch (e) {
              console.error('Failed to parse SSE:', e);
            }
          }
        }
      }

      setIsTyping(false);
      setIsLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Sorry, something went wrong: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: Date.now(),
        },
      ]);
      setIsTyping(false);
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Header */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm"
      >
        <div className="container mx-auto max-w-4xl px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  Chat at llm.christmas
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Powered by AI
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearChat}
              className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Chat Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="container mx-auto max-w-4xl px-4 py-6">
          <AnimatePresence initial={false}>
            {messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex min-h-[60vh] items-center justify-center"
              >
                <div className="text-center space-y-4">
                  <motion.div
                    animate={{
                      scale: [1, 1.1, 1],
                      rotate: [0, 5, -5, 0],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                    className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-2xl"
                  >
                    <Bot className="h-10 w-10" />
                  </motion.div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                      Welcome to AI Chat
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400">
                      Ask me anything, I'm here to help
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className={cn(
                  'mb-6 flex gap-4',
                  message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                )}
              >
                <Avatar className={cn(
                  'h-8 w-8 shrink-0',
                  message.role === 'user' ? 'bg-blue-500' : 'bg-purple-500'
                )}>
                  <AvatarFallback className="text-white">
                    {message.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </AvatarFallback>
                </Avatar>

                <Card className={cn(
                  'flex-1 overflow-hidden p-4 shadow-md',
                  message.role === 'user'
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white'
                    : 'bg-white dark:bg-slate-800'
                )}>
                  <div className="mb-2 flex items-center justify-between">
                    <Badge
                      variant={message.role === 'user' ? 'default' : 'secondary'}
                      className={cn(
                        message.role === 'user' ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'
                      )}
                    >
                      {message.role === 'user' ? 'You' : 'AI'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(message.content)}
                      className="h-6 w-6 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className={cn(
                    'prose prose-sm max-w-none',
                    message.role === 'user' ? 'prose-invert' : 'dark:prose-invert'
                  )}>
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
                              <code
                                {...props}
                                className={cn(
                                  'rounded bg-slate-100 px-1.5 py-0.5 text-sm font-medium dark:bg-slate-700',
                                  className
                                )}
                              >
                                {children}
                              </code>
                            );
                          },
                          pre({ children }: any) {
                            return <>{children}</>;
                          },
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}

            {isTyping && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 flex gap-4"
              >
                <Avatar className="h-8 w-8 shrink-0 bg-purple-500">
                  <AvatarFallback className="text-white">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <Card className="flex-1 overflow-hidden p-4 shadow-md bg-white dark:bg-slate-800">
                  <div className="flex items-center gap-2">
                    <motion.div
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="h-2 w-2 rounded-full bg-purple-500"
                    />
                    <motion.div
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
                      className="h-2 w-2 rounded-full bg-purple-500"
                    />
                    <motion.div
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
                      className="h-2 w-2 rounded-full bg-purple-500"
                    />
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* Input Area */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm"
      >
        <div className="container mx-auto max-w-4xl px-4 py-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message... (Press Enter to send)"
                className="min-h-[60px] max-h-[200px] resize-none border-slate-300 bg-white shadow-sm focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:focus:border-blue-400"
                disabled={isLoading}
              />
            </div>
            <Button
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              size="icon"
              className="h-14 w-14 shrink-0 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg hover:shadow-xl transition-all hover:scale-105"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </div>
          <p className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </motion.div>
    </div>
  );
}