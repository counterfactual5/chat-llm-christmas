/**
 * Declarative chat boot schedule + fixed-latency simulator.
 * Used by tools/eval/boot/measure.mjs and unit tests so experiments can change
 * topology without hitting the live network.
 */

export type HydrateReadyWhen = 'after-local' | 'after-cloud';
export type ModelsStartWhen = 'after-hydrate-ready' | 'parallel-with-cloud';

export type BootSchedule = {
  /** When chatsHydrated flips true for a bound account. */
  hydrateReadyWhen: HydrateReadyWhen;
  /** When fetchModels (and siblings) are kicked off relative to cloud sync. */
  modelsStartWhen: ModelsStartWhen;
  /**
   * Models cache is only read after account bound/unbound is known.
   * Must stay true (product constraint from models-list local cache plan).
   */
  authBeforeModelsCache: boolean;
};

/** Matches chat-container + use-session-persist wiring. */
export const CURRENT_BOOT_SCHEDULE: BootSchedule = {
  hydrateReadyWhen: 'after-local',
  modelsStartWhen: 'parallel-with-cloud',
  authBeforeModelsCache: true,
};

export type BootLatencies = {
  accountMs: number;
  localHydrateMs: number;
  cloudSyncMs: number;
  modelsMs: number;
  /** When models cache hits, paint cost after fetchModels is invoked. */
  modelsCachePaintMs: number;
  skillsMs: number;
  memoriesMs: number;
  integrationsMs: number;
  /** Use cache hit timings for models path. */
  modelsCacheHit: boolean;
};

/** Representative cold-ish bound session (sync slow, no models cache). */
export const DEFAULT_BOOT_LATENCIES: BootLatencies = {
  accountMs: 50,
  localHydrateMs: 5,
  cloudSyncMs: 2000,
  modelsMs: 800,
  modelsCachePaintMs: 5,
  skillsMs: 400,
  memoriesMs: 400,
  integrationsMs: 400,
  modelsCacheHit: false,
};

export type BootSimulation = {
  interactive_ms: number;
  full_boot_ms: number;
  cloud_on_critical_path: 0 | 1;
  models_after_cloud: 0 | 1;
  schedule_valid: 0 | 1;
  auth_before_models_cache: 0 | 1;
};

export function isBootScheduleValid(schedule: BootSchedule): boolean {
  if (!schedule.authBeforeModelsCache) return false;
  if (
    schedule.hydrateReadyWhen !== 'after-local' &&
    schedule.hydrateReadyWhen !== 'after-cloud'
  ) {
    return false;
  }
  if (
    schedule.modelsStartWhen !== 'after-hydrate-ready' &&
    schedule.modelsStartWhen !== 'parallel-with-cloud'
  ) {
    return false;
  }
  return true;
}

/**
 * Simulate bound-account boot wall times under fixed latencies.
 * Interactive = chatsHydrated + models ready (cache paint or network).
 */
export function simulateBootCriticalPath(
  schedule: BootSchedule,
  latencies: BootLatencies = DEFAULT_BOOT_LATENCIES,
): BootSimulation {
  const valid = isBootScheduleValid(schedule);
  const authOk = schedule.authBeforeModelsCache ? 1 : 0;
  if (!valid) {
    return {
      interactive_ms: Number.POSITIVE_INFINITY,
      full_boot_ms: Number.POSITIVE_INFINITY,
      cloud_on_critical_path: 1,
      models_after_cloud: 1,
      schedule_valid: 0,
      auth_before_models_cache: authOk as 0 | 1,
    };
  }

  const t0 = 0;
  const afterAccount = t0 + latencies.accountMs;
  const afterLocal = afterAccount + latencies.localHydrateMs;
  const cloudDone = afterLocal + latencies.cloudSyncMs;

  const hydrateReadyAt =
    schedule.hydrateReadyWhen === 'after-local' ? afterLocal : cloudDone;

  const modelsStartAt =
    schedule.modelsStartWhen === 'parallel-with-cloud'
      ? afterLocal
      : hydrateReadyAt;

  const modelsDuration = latencies.modelsCacheHit
    ? latencies.modelsCachePaintMs
    : latencies.modelsMs;
  const modelsReadyAt = modelsStartAt + modelsDuration;

  const auxStartAt = modelsStartAt;
  const auxDoneAt =
    auxStartAt +
    Math.max(latencies.skillsMs, latencies.memoriesMs, latencies.integrationsMs);

  const interactive_ms = Math.max(hydrateReadyAt, modelsReadyAt);
  const full_boot_ms = Math.max(cloudDone, modelsReadyAt, auxDoneAt);

  return {
    interactive_ms,
    full_boot_ms,
    cloud_on_critical_path: hydrateReadyAt >= cloudDone ? 1 : 0,
    models_after_cloud: modelsStartAt >= cloudDone ? 1 : 0,
    schedule_valid: 1,
    auth_before_models_cache: 1,
  };
}
