import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamTimeoutError, streamWaitBudget } from '@/lib/chat/server/stream-budget';

describe('stream budget helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the tighter of idle and total remaining budgets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));

    expect(
      streamWaitBudget({
        startedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        lastChunkAt: Date.parse('2026-01-01T00:00:08.000Z'),
        idleMs: 5_000,
        maxTotalMs: 30_000,
      }),
    ).toBe(3_000);
  });

  it('prefers the total-budget error when the hard cap is exhausted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:05:00.000Z'));

    expect(
      streamTimeoutError(
        'Upstream stream',
        90_000,
        240_000,
        Date.parse('2026-01-01T00:00:00.000Z'),
        Date.parse('2026-01-01T00:04:50.000Z'),
      ).message,
    ).toBe('Upstream stream exceeded 240s total budget');
  });

  it('reports idle stalls when the total budget still remains', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:01:30.000Z'));

    expect(
      streamTimeoutError(
        'Tools round',
        90_000,
        240_000,
        Date.parse('2026-01-01T00:00:00.000Z'),
        Date.parse('2026-01-01T00:00:00.000Z'),
      ).message,
    ).toBe('Tools round stalled for 90s (no upstream chunks)');
  });
});
