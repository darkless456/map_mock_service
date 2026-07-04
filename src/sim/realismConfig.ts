import { fixtureLoader } from '../fixtures';
import type { RealismConfig } from './chaos';

export function readRealismConfig(): RealismConfig {
  return fixtureLoader.read('sim/realism.jsonc', raw => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('fixtures/sim/realism.jsonc must contain an object');
    }
    const value = raw as Record<string, unknown>;
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
      httpDelayMinMs: readNumber(value.httpDelayMinMs),
      httpDelayMaxMs: readNumber(value.httpDelayMaxMs),
      wsDelayMinMs: readNumber(value.wsDelayMinMs),
      wsDelayMaxMs: readNumber(value.wsDelayMaxMs),
    };
  });
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
