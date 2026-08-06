import { describe, expect, it } from 'vitest';
import {
  isResearchSessionBusy,
  isSessionBusy,
  researchBusySessionIdFrom,
} from '@/lib/chat/session/busy';

describe('session busy SSOT', () => {
  it('maps research hook state to a scoped session id', () => {
    expect(researchBusySessionIdFrom(true, 's1')).toBe('s1');
    expect(researchBusySessionIdFrom(true, null)).toBeNull();
    expect(researchBusySessionIdFrom(false, 's1')).toBeNull();
  });

  it('treats chat loading and scoped research as the same busy signal', () => {
    const input = {
      loadingBySession: { s1: true },
      researchBusySessionId: 's2' as string | null,
    };
    expect(isSessionBusy('s1', input)).toBe(true);
    expect(isSessionBusy('s2', input)).toBe(true);
    expect(isSessionBusy('s3', input)).toBe(false);
    expect(isSessionBusy(null, input)).toBe(false);
  });

  it('does not treat another session research as busy for this row', () => {
    expect(isResearchSessionBusy('s1', 's2')).toBe(false);
    expect(isResearchSessionBusy('s2', 's2')).toBe(true);
  });
});
