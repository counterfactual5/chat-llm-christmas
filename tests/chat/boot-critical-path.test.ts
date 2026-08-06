import { describe, expect, it } from 'vitest';
import {
  CURRENT_BOOT_SCHEDULE,
  DEFAULT_BOOT_LATENCIES,
  isBootScheduleValid,
  simulateBootCriticalPath,
  type BootSchedule,
} from '@/lib/chat/boot/critical-path';

describe('boot critical path schedule', () => {
  it('marks the current production schedule as valid', () => {
    expect(isBootScheduleValid(CURRENT_BOOT_SCHEDULE)).toBe(true);
    expect(CURRENT_BOOT_SCHEDULE.authBeforeModelsCache).toBe(true);
  });

  it('rejects schedules that read models cache before auth', () => {
    const bad: BootSchedule = {
      ...CURRENT_BOOT_SCHEDULE,
      authBeforeModelsCache: false,
    };
    expect(isBootScheduleValid(bad)).toBe(false);
  });

  it('current schedule: local-first + parallel models (cloud off interactive path)', () => {
    const sim = simulateBootCriticalPath(
      CURRENT_BOOT_SCHEDULE,
      DEFAULT_BOOT_LATENCIES,
    );
    // account+local+models = 50+5+800 = 855
    expect(sim.interactive_ms).toBe(855);
    expect(sim.cloud_on_critical_path).toBe(0);
    expect(sim.models_after_cloud).toBe(0);
    expect(sim.full_boot_ms).toBe(2055);
  });

  it('legacy serial schedule keeps cloud on the critical path', () => {
    const schedule: BootSchedule = {
      hydrateReadyWhen: 'after-cloud',
      modelsStartWhen: 'after-hydrate-ready',
      authBeforeModelsCache: true,
    };
    const sim = simulateBootCriticalPath(schedule, DEFAULT_BOOT_LATENCIES);
    expect(sim.interactive_ms).toBe(2855);
    expect(sim.cloud_on_critical_path).toBe(1);
    expect(sim.models_after_cloud).toBe(1);
  });
});
