#!/usr/bin/env node
/**
 * Measure chat boot critical path under fixed mock latencies.
 * Immutable during ce-optimize — experiments change lib/chat/boot/ only.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function runVitest() {
  const r = spawnSync(
    'npx',
    ['vitest', 'run', 'tests/chat/boot-critical-path.test.ts'],
    { cwd: root, encoding: 'utf8', timeout: 90_000 },
  );
  if (r.status !== 0) {
    process.stderr.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
  }
  return r.status === 0 ? 1 : 0;
}

const tests_passed = runVitest();

const script = `
import {
  CURRENT_BOOT_SCHEDULE,
  DEFAULT_BOOT_LATENCIES,
  simulateBootCriticalPath,
} from './lib/chat/boot/critical-path.ts';
const cold = simulateBootCriticalPath(CURRENT_BOOT_SCHEDULE, DEFAULT_BOOT_LATENCIES);
const warm = simulateBootCriticalPath(CURRENT_BOOT_SCHEDULE, {
  ...DEFAULT_BOOT_LATENCIES,
  modelsCacheHit: true,
});
const out = {
  interactive_ms: cold.interactive_ms,
  full_boot_ms: cold.full_boot_ms,
  cloud_on_critical_path: cold.cloud_on_critical_path,
  models_after_cloud: cold.models_after_cloud,
  schedule_valid: cold.schedule_valid,
  auth_before_models_cache: cold.auth_before_models_cache,
  tests_passed: ${tests_passed},
  warm_interactive_ms: warm.interactive_ms,
  warm_full_boot_ms: warm.full_boot_ms,
};
if (!Number.isFinite(out.interactive_ms)) {
  out.interactive_ms = 1e12;
  out.full_boot_ms = 1e12;
}
console.log(JSON.stringify(out));
`;

const r = spawnSync('npx', ['tsx', '-e', script], {
  cwd: root,
  encoding: 'utf8',
  timeout: 60_000,
});
if (r.status !== 0) {
  process.stderr.write(r.stderr || r.stdout || 'tsx failed\n');
  process.exit(1);
}
process.stdout.write((r.stdout || '').trim() + '\n');
