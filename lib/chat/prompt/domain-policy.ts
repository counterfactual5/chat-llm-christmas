/**
 * Single product-wide domain policy for Christmas Chat.
 *
 * Owned by the chat frontend server layer (not hooks — this is not UI state).
 * Ordinary /api/chat injects chat prompts; /api/research attaches domainContext
 * (+ research domainPolicy snapshot) so chat-api never re-classifies text.
 */

export type DomainContext = {
  domain: 'general' | 'medical' | 'financial';
  risk: 'low' | 'medium' | 'high';
  intent:
    | 'informational'
    | 'health_guidance'
    | 'urgent_health'
    | 'financial_decision'
    | 'high_risk_financial_action';
};

export type ResearchDomainPolicy = {
  synthesisSections: string[];
  synthesisGuidance: string[];
  reportGuidance: string[];
};

const MEDICAL_RE =
  /抽筋|疼痛|症状|治疗|药物|疾病|就医|医生|医院|睡眠|肌肉|营养|血压|血糖|胸痛|呼吸|发烧|头晕|怀孕|medical|health|pain|symptom|disease|medicine|doctor|hospital/i;
const MEDICAL_HIGH_RE =
  /胸痛|呼吸困难|喘不上气|昏厥|失去意识|严重出血|自杀|过量服药|中毒|单侧无力|口齿不清|急诊|立刻停药|擅自停药|chest pain|difficulty breathing|unconscious|severe bleeding|overdose|suicid|stroke/i;
const FINANCIAL_RE =
  /投资|股票|基金|债券|期权|期货|杠杆|合约|买入|卖出|仓位|止损|收益|亏损|借钱|贷款|加仓|抄底|加密货币|虚拟币|币价|币圈|代币|比特币|以太坊|btc|eth|crypto|stock|invest|portfolio|leverage|futures|options/i;
const FINANCIAL_HIGH_RE =
  /借钱|贷款|全部|全仓|梭哈|满仓|杠杆|合约|期权|期货|保证金|爆仓|抵押|20\s*倍|50\s*倍|100\s*倍|borrow|loan|all[- ]?in|max leverage|margin/i;
const ACTION_RE =
  /怎么办|该不该|要不要|能不能|是否应该|怎么治疗|怎么吃|用什么药|买还是卖|买入|卖出|配置|仓位|止损|should i|what should i do|buy or sell|how much/i;

export function classifyDomain(text: string): DomainContext {
  const raw = String(text || '').trim();
  if (!raw) return { domain: 'general', risk: 'low', intent: 'informational' };

  if (MEDICAL_RE.test(raw)) {
    const high = MEDICAL_HIGH_RE.test(raw);
    return {
      domain: 'medical',
      risk: high ? 'high' : ACTION_RE.test(raw) ? 'medium' : 'low',
      intent: high ? 'urgent_health' : ACTION_RE.test(raw) ? 'health_guidance' : 'informational',
    };
  }

  if (FINANCIAL_RE.test(raw)) {
    const high = FINANCIAL_HIGH_RE.test(raw);
    return {
      domain: 'financial',
      risk: high ? 'high' : ACTION_RE.test(raw) ? 'medium' : 'low',
      intent: high ? 'high_risk_financial_action' : ACTION_RE.test(raw) ? 'financial_decision' : 'informational',
    };
  }

  return { domain: 'general', risk: 'low', intent: 'informational' };
}

/** System-prompt fragment for ordinary chat. Empty for general questions. */
export function domainPolicyPrompt(text: string): string {
  return chatDomainPolicyPrompt(classifyDomain(text));
}

export function chatDomainPolicyPrompt(context: DomainContext): string {
  if (context.domain === 'medical') {
    return [
      'Domain policy — medical/health:',
      '- Separate general information from an individual diagnosis; do not claim to diagnose remotely.',
      '- Distinguish common causes, possible triggers, and conditions requiring evaluation.',
      '- Do not advise stopping or changing prescription medication without the prescriber.',
      '- Give concrete red flags only when relevant; avoid generic alarmist disclaimers.',
      context.risk === 'high'
        ? '- High-risk symptoms are present: lead with immediate local emergency/urgent-care action before explanation. Do not delay action for web research.'
        : '- For non-urgent questions, answer directly first, then give practical self-care and when-to-seek-care guidance.',
    ].join('\n');
  }
  if (context.domain === 'financial') {
    return [
      'Domain policy — financial/investment:',
      '- Separate current facts, historical data, assumptions, scenarios, and forecasts.',
      '- Never guarantee returns or use certainty language such as “稳赚” or “肯定上涨”.',
      '- For personal decisions, surface missing constraints: horizon, liquidity needs, position size, risk tolerance, and maximum acceptable loss.',
      context.risk === 'high'
        ? '- High-risk action is proposed: explicitly challenge borrowing, all-in positioning, and high leverage; prioritize deleveraging and loss containment.'
        : '- Avoid boilerplate disclaimers for basic factual questions; add decision-risk context only when the user is considering an action.',
    ].join('\n');
  }
  return '';
}

/** Research synthesis / report structure for a classified domain. */
export function researchDomainPolicy(
  context: DomainContext,
  mode?: string,
): ResearchDomainPolicy {
  const lengthLine =
    mode === 'rigorous'
      ? '目标篇幅约 8000–12000 字正文（不含来源列表；rigorous）；宁可密而完整，禁止为凑字注水，也不要为了“短”丢掉跨源对比与不确定性说明。'
      : mode === 'quick'
        ? '目标篇幅约 500–1200 字正文（不含来源列表；quick）；抓住直答与关键依据，不要注水。'
        : '目标篇幅约 3000–4500 字正文（不含来源列表；standard）；宁可密而完整，禁止为凑字注水，也不要为了“短”丢掉跨源对比与不确定性说明。';
  const lengthLineFinancial =
    mode === 'rigorous'
      ? '目标篇幅约 8000–12000 字正文（不含来源列表；rigorous）；数字必须带时间与来源编号。'
      : mode === 'quick'
        ? '目标篇幅约 500–1200 字正文（不含来源列表；quick）；数字必须带时间与来源编号。'
        : '目标篇幅约 3000–4500 字正文（不含来源列表；standard）；数字必须带时间与来源编号。';
  const lengthLineGeneral =
    mode === 'rigorous'
      ? '目标篇幅约 8000–12000 字正文（不含来源列表；rigorous）；宁可密而完整，禁止为凑字注水，也不要为了“短”丢掉依据。'
      : mode === 'quick'
        ? '目标篇幅约 500–1200 字正文（不含来源列表；quick）；抓住关键对比与结论，不要注水。'
        : '目标篇幅约 3000–4500 字正文（不含来源列表；standard）；宁可密而完整，禁止为凑字注水，也不要为了“短”丢掉依据。';

  if (context.domain === 'medical') {
    return {
      synthesisSections: [
        '## 证据边界',
        '## 可能机制与诱因',
        '## 替代解释与风险分层',
        '## 用户问题应答计划',
      ],
      synthesisGuidance: [
        '区分直接证据、间接证据和合理但未证实的解释。',
        '区分常见原因、可能诱因和已证实病因；相关性不得写成因果。',
        '不要强行制造“反直觉发现”。',
      ],
      reportGuidance: [
        '结构必须包含：用户问题直答 → 常见原因/机制 → 当下怎么处理 → 何时需要就医 → 来源列表。',
        '健康类也要有实质分析深度：把 SYNTHESIS 里的机制、诱因分层、替代解释和证据边界写进对应章节，不要收成三五行的就医手册摘要。',
        lengthLine,
        '明确说明无法在线诊断；给出具体但不过度恐吓的红旗症状。',
        context.risk === 'high'
          ? '这是高风险健康意图：开头先给及时就医/急救行动，不要先展开长篇背景。'
          : '',
      ].filter(Boolean),
    };
  }

  if (context.domain === 'financial') {
    return {
      synthesisSections: [
        '## 数据与时间边界',
        '## 用户问题应答计划',
        '## 驱动因素与反方证据',
        '## 情景与风险',
      ],
      synthesisGuidance: [
        '区分历史事实、当前数据、市场共识、模型假设和作者推断。',
        '所有价格、估值、收益率、仓位或百分比必须说明时间和来源。',
        '主动寻找反方证据、下行情景和流动性/杠杆风险。',
      ],
      reportGuidance: [
        '结构必须包含：用户问题直答 → 关键数据与时间边界 → 驱动因素与反方证据 → 情景与风险 → 来源列表。',
        '把 SYNTHESIS 的跨源对比、反方证据与不确定性写进正文，不要收成几条口号式投资建议。',
        lengthLineFinancial,
        '不得作收益保证或使用“肯定上涨/稳赚”等确定性措辞。',
        '涉及行动决策时说明期限、风险承受能力、仓位和最大可接受亏损等缺失条件。',
        context.risk === 'high'
          ? '这是高风险金融行动：明确反对借贷、全仓或高杠杆作为默认方案，优先给风险控制与降杠杆建议。'
          : '',
      ].filter(Boolean),
    };
  }

  return {
    synthesisSections: [
      '## 数据缺口',
      '## 用户问题应答计划',
      '## 跨源对比',
      '## 因果分析',
    ],
    synthesisGuidance: ['仅在确有依据时写反直觉发现，不为满足模板强行制造洞察。'],
    reportGuidance: [
      '结构必须包含：用户问题直答 → 关键发现与跨源对比 → 因果/机制分析 → 局限与不确定性 → 来源列表。',
      '把 SYNTHESIS 的跨源对比与因果链写进正文，不要收成条目清单。',
      lengthLineGeneral,
    ],
  };
}

/** Attach domain classification + research policy snapshot for chat-api workers. */
export function researchDomainPayload(
  query: string,
  mode?: string,
): {
  domainContext: DomainContext;
  domainPolicy: ResearchDomainPolicy;
} {
  const domainContext = classifyDomain(query);
  return {
    domainContext,
    domainPolicy: researchDomainPolicy(domainContext, mode),
  };
}
