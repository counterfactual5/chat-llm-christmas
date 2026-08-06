import { describe, expect, it } from 'vitest';
import {
  classifyDomain,
  domainPolicyPrompt,
  researchDomainPayload,
  researchDomainPolicy,
} from '@/lib/chat/prompt/domain-policy';

describe('domain policy', () => {
  it('keeps basic informational questions low risk', () => {
    expect(classifyDomain('什么是高血压？')).toMatchObject({
      domain: 'medical',
      risk: 'low',
      intent: 'informational',
    });
    expect(classifyDomain('BTC 是什么？')).toMatchObject({
      domain: 'financial',
      risk: 'low',
      intent: 'informational',
    });
  });

  it('detects urgent health and high-risk financial actions', () => {
    expect(classifyDomain('胸痛、冷汗而且喘不上气怎么办')).toMatchObject({
      domain: 'medical',
      risk: 'high',
      intent: 'urgent_health',
    });
    expect(classifyDomain('我要贷款全仓 20 倍杠杆买 BTC')).toMatchObject({
      domain: 'financial',
      risk: 'high',
      intent: 'high_risk_financial_action',
    });
  });

  it('injects focused guidance without affecting general chat', () => {
    expect(domainPolicyPrompt('帮我写一个 CSS grid')).toBe('');
    expect(domainPolicyPrompt('胸痛呼吸困难怎么办')).toContain('immediate local emergency');
    expect(domainPolicyPrompt('贷款全仓买 BTC')).toContain('borrowing');
  });

  it('builds a research snapshot from one shared classifier', () => {
    const payload = researchDomainPayload('睡觉抽筋是不是吹空调导致的');
    expect(payload.domainContext.domain).toBe('medical');
    expect(payload.domainPolicy.synthesisSections).toEqual(
      researchDomainPolicy(payload.domainContext).synthesisSections,
    );
    expect(payload.domainPolicy.synthesisSections).toContain('## 证据边界');
  });

  it('emits mode-aware report length guidance', () => {
    const std = researchDomainPolicy({ domain: 'general', risk: 'low', intent: 'informational' }, 'standard');
    const rig = researchDomainPolicy({ domain: 'general', risk: 'low', intent: 'informational' }, 'rigorous');
    expect(std.reportGuidance.some((l) => /1800–2800/.test(l))).toBe(true);
    expect(rig.reportGuidance.some((l) => /2800–4500/.test(l))).toBe(true);
    expect(std.reportGuidance.some((l) => /1200–2500/.test(l))).toBe(false);
  });

  it('does not treat a bare 币 as financial', () => {
    expect(classifyDomain('人民币的币字怎么写').domain).toBe('general');
  });
});
