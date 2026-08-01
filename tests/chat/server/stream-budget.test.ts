import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boundedAsyncIterator,
  streamTimeoutError,
  streamWaitBudget,
} from '@/lib/chat/server/stream-budget';

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

describe('boundedAsyncIterator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function* asyncFrom<T>(values: T[]): AsyncGenerator<T> {
    for (const v of values) yield v;
  }

  it('passes values through unchanged when the upstream finishes in budget', async () => {
    const out: number[] = [];
    for await (const v of boundedAsyncIterator(asyncFrom([1, 2, 3]), {
      idleMs: 5_000,
      maxTotalMs: 30_000,
      label: 'test round',
    })) {
      out.push(v);
    }
    expect(out).toEqual([1, 2, 3]);
  });

  it('throws an idle-stall timeout once the upstream stops yielding', async () => {
    vi.useFakeTimers();
    async function* stallsAfterOne() {
      yield 1;
      await new Promise(() => {}); // never resolves — simulates a stalled upstream
    }

    const collected: number[] = [];
    let caught: Error | null = null;
    const run = (async () => {
      try {
        for await (const v of boundedAsyncIterator(stallsAfterOne(), {
          idleMs: 1_000,
          maxTotalMs: 60_000,
          label: 'tools round',
        })) {
          collected.push(v);
        }
      } catch (err) {
        caught = err as Error;
      }
    })();

    await vi.advanceTimersByTimeAsync(1_000);
    await run;

    expect(collected).toEqual([1]);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error | null)?.message).toBe(
      'tools round stalled for 1s (no upstream chunks)',
    );
  });

  it('propagates non-timeout errors from the upstream iterator as-is', async () => {
    async function* explodes(): AsyncGenerator<number> {
      yield 1;
      throw new Error('upstream exploded');
    }

    const collected: number[] = [];
    await expect(async () => {
      for await (const v of boundedAsyncIterator(explodes(), {
        idleMs: 5_000,
        maxTotalMs: 30_000,
        label: 'test round',
      })) {
        collected.push(v);
      }
    }).rejects.toThrow('upstream exploded');
    expect(collected).toEqual([1]);
  });
});
