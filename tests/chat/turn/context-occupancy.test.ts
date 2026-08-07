import { describe, expect, it } from 'vitest';
import {
  occupancyFromEstimateAndMeasured,
  sendProjectionFromEstimateAndMeasured,
} from '@/lib/chat/turn/context-occupancy';

describe('context-occupancy floors', () => {
  it('keeps the estimate when there is no measured usage', () => {
    expect(occupancyFromEstimateAndMeasured(49_108, null)).toBe(49_108);
    expect(sendProjectionFromEstimateAndMeasured(50_000, null, 100)).toBe(50_000);
  });

  it('floors idle occupancy with prompt + completion', () => {
    expect(
      occupancyFromEstimateAndMeasured(49_108, {
        prompt_tokens: 61_937,
        completion_tokens: 1_567,
      }),
    ).toBe(61_937 + 1_567);
  });

  it('does not raise occupancy when estimate is already higher', () => {
    expect(
      occupancyFromEstimateAndMeasured(80_000, {
        prompt_tokens: 61_937,
        completion_tokens: 1_567,
      }),
    ).toBe(80_000);
  });

  it('floors send projection with measured exchange + next user extra', () => {
    expect(
      sendProjectionFromEstimateAndMeasured(
        50_000,
        { prompt_tokens: 61_937, completion_tokens: 1_567 },
        200,
      ),
    ).toBe(61_937 + 1_567 + 200);
  });
});
