'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Locale = 'zh' | 'en';

const STORAGE_KEY = 'llm_christmas_locale';

const dict = {
  en: {
    newChat: 'New Chat',
    skills: 'Skills',
    newSkill: 'New Skill',
    recent: 'Recent',
    exportMarkdown: 'Export Markdown',
    deleteChat: 'Delete Chat',
    deleteConversation: 'Delete conversation',
    deleteConversationConfirm: 'Delete “{title}”? This cannot be undone.',
    cancel: 'Cancel',
    delete: 'Delete',
    deleting: 'Deleting…',
    accountConnected: 'Account connected',
    connectAccount: 'Connect llm.christmas',
    accountConnectedHint: 'Using your main-site quota',
    connectAccountHint: 'Sign in once — no API key copy',
    integrations: 'Integrations',
    integrationsHint: 'Each account keeps its own OAuth tokens',
    connectNotion: 'Connect Notion',
    disconnectNotion: 'Disconnect Notion',
    notionConnected: 'Notion connected',
    notionNotConfigured: 'Notion MCP is unavailable on this server',
    notionConnectHint: 'Authorize your own workspace — never shared with other users',
    notionConnectCardTitle: 'Notion',
    notionConnectCardBody:
      'Connect via Notion MCP to search, read, and edit pages you can access.',
    writingNotion: 'Updating Notion…',
    wroteNotion: 'Updated Notion',
    notionWorkspace: 'Workspace',
    mcpTools: 'MCP',
    enableNotionMcp: 'Notion',
    enableNotionMcpHint: 'Search, read, and edit your connected Notion in this chat',
    notionMcpNeedsConnect: 'Connect Notion in account settings first',
    notionMcpOn: 'Notion on',
    disableNotionMcp: 'Remove Notion from this chat',
    accountSection: 'Main account',
    accountSectionHint: 'Quota and paid models from llm.christmas',
    mcpSection: 'MCP extensions',
    mcpSectionHint: 'Separate OAuth — not the same as signing in above',
    mcpSidebarHint: 'Connections for this chat',
    useInThisChat: 'Use in this chat',
    manageAccount: 'Manage account',
    signOutAccount: 'Sign out',
    context: 'Context',
    thinking: 'Thinking…',
    thoughtProcess: 'Thought process',
    searchingWeb: 'Searching the web…',
    searchedWeb: 'Searched the web',
    searchingNotion: 'Searching Notion…',
    searchedNotion: 'Searched Notion',
    readingNotion: 'Reading Notion page…',
    readNotion: 'Read Notion page',
    fetchingResults: 'Fetching results…',
    searchedVia: 'via {provider}',
    searchNoResults: 'No results',
    searchFailed: 'Search returned no results',
    searchSourcesInMaterial: '{n} sources saved to Reference Material',
    webSearchSources: 'Web search',
    notionSources: 'Notion',
    referenceSources: 'Sources',
    clearWebSources: 'Clear sources',
    referencePlaceholder: 'Paste context, docs, or background info here…',
    requestFailed: 'Request failed',
    retry: 'Retry',
    continue: 'Continue',
    stop: 'Stop',
    send: 'Send',
    clear: 'Clear',
    queued: 'queued',
    queuePaused: 'Paused',
    resumeQueue: 'Resume queue',
    sendNow: 'Send',
    searchModels: 'Search models…',
    allModels: 'All Models',
    freeModels: 'Free Models',
    modelsCount: '{n} models',
    modelsFiltered: '{shown} / {total}',
    noModelsMatch: 'No models match “{q}”',
    noModelsFound: 'No models found. Check connection.',
    noFreeModels: 'No free models available.',
    loading: 'Loading…',
    loadingModels: 'Loading models…',
    selectModel: 'Select Model',
    signInUnlock: 'Sign in to unlock {what}',
    allModelsLower: 'all models',
    premium: 'premium',
    generateImage: 'Generate image',
    imageHint: '/image',
    writeMessage: 'Ask {model}…  (/image, /skills, drop files)',
    quote: 'Quote',
    quoted: 'Quoted',
    quotedCount: 'Quoted ({n})',
    clearQuote: 'Remove quote',
    clearAllQuotes: 'Clear all quotes',
    heroTitle: 'Universal AI at llm.christmas',
    heroSubtitle: 'Connected directly to llm.christmas gateway.',
    clickToAsk: 'Click to ask →',
    starter1: 'Write a TypeScript API endpoint',
    starter2: 'Explain a concept in simple terms',
    starter3: 'Write a TypeScript fetch wrapper with retry and timeout',
    starter4: 'Help me draft a clear project README',
    language: 'Language',
    languageZh: '中文',
    languageEn: 'English',
    theme: 'Appearance',
    themeLight: 'Light',
    themeDark: 'Dark',
    settings: 'Settings',
    signOut: 'Sign out',
    connect: 'Connect account',
    messagesCount: '{n} messages',
    generating: 'Generating',
    deleteSkill: 'Delete Skill',
    deleteSkillConfirm: 'Delete “{title}”? This cannot be undone.',
    skillName: 'Name',
    skillContent: 'Content',
    skillBrief: 'Describe what this skill should do',
    save: 'Save',
    generate: 'Generate with AI',
    generatingSkill: 'Generating…',
    saving: 'Saving…',
    compact: 'Compact',
    attachments: 'Attachments',
    referenceMaterial: 'Reference Material',
    systemPrompt: 'System Prompt',
    vision: 'Vision',
    pro: 'Pro',
    free: 'Free',
    textOnlyNeedsVision: 'Text-only · needs vision',
    textOnlyConversation: 'Text-only — this conversation has images',
    enableSkill: 'Enable Skill · /{name}',
    disableSkill: 'Enabled /{name} — click to disable',
    authTitle: 'Connect account',
    authWelcomeTitle: 'Welcome to Christmas Chat',
    authWelcomeBody: 'Sign in with llm.christmas to use your balance and paid models in this chat.',
    authHint: 'Paste your llm.christmas API key, or sign in on the main site.',
    authBoundHint: 'Your llm.christmas account is connected. Balance and paid models are shared automatically.',
    authSignInHint: 'Sign in on the main site and authorize Chat. Balance and paid models will be shared automatically.',
    continueWithSite: 'Continue with llm.christmas',
    manualApiKeyFallback: 'Manual API Key fallback',
    apiTokenLabel: 'API Token (sk-...)',
    validating: 'Validating…',
    saveAndConnect: 'Save & Connect',
    bind: 'Bind key',
    binding: 'Binding…',
    copied: 'Copied',
    copy: 'Copy',
  },
  zh: {
    newChat: '新对话',
    skills: 'Skills',
    newSkill: '新建 Skill',
    recent: '最近',
    exportMarkdown: '导出 Markdown',
    deleteChat: '删除对话',
    deleteConversation: '删除对话',
    deleteConversationConfirm: '确定删除「{title}」？此操作无法撤销。',
    cancel: '取消',
    delete: '删除',
    deleting: '删除中…',
    accountConnected: '主站账号已连接',
    connectAccount: '连接 llm.christmas 账号',
    accountConnectedHint: '自动使用主站账号额度',
    connectAccountHint: '登录一次，无需复制 API Key',
    integrations: '扩展连接',
    integrationsHint: '每个账号各自授权，互不共享',
    connectNotion: '连接 Notion',
    disconnectNotion: '断开 Notion',
    notionConnected: 'Notion 已连接',
    notionNotConfigured: '服务器 Notion MCP 暂不可用',
    notionConnectHint: '授权你自己的工作区，不会与其他用户共用',
    notionConnectCardTitle: 'Notion',
    notionConnectCardBody: '通过 Notion 官方 MCP 连接，可搜索、阅读和编辑你有权限的页面。',
    writingNotion: '正在更新 Notion…',
    wroteNotion: '已更新 Notion',
    notionWorkspace: '工作区',
    mcpTools: 'MCP',
    enableNotionMcp: 'Notion',
    enableNotionMcpHint: '在本对话中搜索、阅读和编辑已连接的 Notion',
    notionMcpNeedsConnect: '请先在账号设置中连接 Notion',
    notionMcpOn: 'Notion 已启用',
    disableNotionMcp: '从本对话移除 Notion',
    accountSection: '主站账号',
    accountSectionHint: '额度与付费模型来自 llm.christmas',
    mcpSection: 'MCP 扩展',
    mcpSectionHint: '另行 OAuth 授权，与上方登录不是同一步',
    mcpSidebarHint: '本对话可用的外部工具',
    useInThisChat: '用于本对话',
    manageAccount: '管理账号',
    signOutAccount: '退出登录',
    context: '上下文',
    thinking: '思考中…',
    thoughtProcess: '思考过程',
    searchingWeb: '正在搜索网页…',
    searchedWeb: '已搜索网页',
    searchingNotion: '正在搜索 Notion…',
    searchedNotion: '已搜索 Notion',
    readingNotion: '正在读取 Notion 页面…',
    readNotion: '已读取 Notion 页面',
    fetchingResults: '正在获取结果…',
    searchedVia: '来源 {provider}',
    searchNoResults: '无结果',
    searchFailed: '搜索未返回结果',
    searchSourcesInMaterial: '{n} 条来源已写入参考资料',
    webSearchSources: '网页搜索',
    notionSources: 'Notion',
    referenceSources: '来源',
    clearWebSources: '清除来源',
    referencePlaceholder: '在此粘贴上下文、文档或背景资料…',
    requestFailed: '请求失败',
    retry: '重试',
    continue: '继续',
    stop: '停止',
    send: '发送',
    clear: '清空',
    queued: '排队中',
    queuePaused: '已暂停',
    resumeQueue: '继续队列',
    sendNow: '立即发送',
    searchModels: '搜索模型…',
    allModels: '全部模型',
    freeModels: '免费模型',
    modelsCount: '{n} 个模型',
    modelsFiltered: '{shown} / {total}',
    noModelsMatch: '没有匹配「{q}」的模型',
    noModelsFound: '未找到模型，请检查连接。',
    noFreeModels: '暂无免费模型。',
    loading: '加载中…',
    loadingModels: '加载模型…',
    selectModel: '选择模型',
    signInUnlock: '登录以解锁{what}',
    allModelsLower: '全部模型',
    premium: '高级模型',
    generateImage: '生成图片',
    imageHint: '/image',
    writeMessage: '问 {model}…  (/image、/skills、拖放文件)',
    quote: '引用',
    quoted: '引用',
    quotedCount: '引用（{n}）',
    clearQuote: '取消引用',
    clearAllQuotes: '清除全部引用',
    heroTitle: 'Universal AI at llm.christmas',
    heroSubtitle: '直连 llm.christmas 网关。',
    clickToAsk: '点击提问 →',
    starter1: '写一个 TypeScript API 接口示例',
    starter2: '用简单的话解释一个概念',
    starter3: '写一个带重试和超时的 TypeScript fetch 封装',
    starter4: '帮我起草一份清晰的项目 README',
    language: '语言',
    languageZh: '中文',
    languageEn: 'English',
    theme: '外观',
    themeLight: '浅色',
    themeDark: '深色',
    settings: '设置',
    signOut: '退出登录',
    connect: '连接账号',
    messagesCount: '{n} 条消息',
    generating: '生成中',
    deleteSkill: '删除 Skill',
    deleteSkillConfirm: '确定删除「{title}」？此操作无法撤销。',
    skillName: '名称',
    skillContent: '内容',
    skillBrief: '用一句话描述这个 Skill 要做什么',
    save: '保存',
    generate: 'AI 生成',
    generatingSkill: '生成中…',
    saving: '保存中…',
    compact: '压缩',
    attachments: '附件',
    referenceMaterial: '参考资料',
    systemPrompt: '系统提示',
    vision: '视觉',
    pro: 'Pro',
    free: '免费',
    textOnlyNeedsVision: '仅文本 · 需要视觉模型',
    textOnlyConversation: '当前对话含图片 — 请选择视觉模型',
    enableSkill: '启用 Skill · /{name}',
    disableSkill: '已启用 /{name} — 再点取消',
    authTitle: '连接账号',
    authWelcomeTitle: '欢迎使用 Christmas Chat',
    authWelcomeBody: '使用 llm.christmas 登录后，即可在本站使用你的额度与付费模型。',
    authHint: '粘贴 llm.christmas API Key，或在主站登录。',
    authBoundHint: '主站账号已连接。额度与付费模型会自动共享。',
    authSignInHint: '在主站登录并授权本 Chat。额度与付费模型会自动共享。',
    continueWithSite: '使用 llm.christmas 继续',
    manualApiKeyFallback: '或手动填写 API Key',
    apiTokenLabel: 'API Token (sk-...)',
    validating: '验证中…',
    saveAndConnect: '保存并连接',
    bind: '绑定密钥',
    binding: '绑定中…',
    copied: '已复制',
    copy: '复制',
  },
} as const;

export type MessageKey = keyof typeof dict.en;

type Vars = Record<string, string | number>;

function format(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] != null ? String(vars[key]) : `{${key}}`,
  );
}

export function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = (navigator.language || '').toLowerCase();
  return lang.startsWith('zh') ? 'zh' : 'en';
}

function readStoredLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'zh' || raw === 'en') return raw;
  } catch {}
  return null;
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLocaleState(readStoredLocale() ?? detectBrowserLocale());
    setReady(true);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Vars) => format(dict[locale][key] ?? dict.en[key] ?? key, vars),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  if (!ready) {
    // Avoid a wrong-language flash: still provide context with browser guess.
    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
  }

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
