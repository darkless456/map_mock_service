import { fixtureLoader } from '../../fixtures';

export interface RechargeNotifySequence {
  readonly idleDelayMs: number;
  readonly steps: ReadonlyArray<{ readonly atMs: number; readonly subStatus: string }>;
}

export function readRechargeNotifySequence(): RechargeNotifySequence {
  return fixtureLoader.read('recharge/notify_sequence.jsonc', raw => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('fixtures/recharge/notify_sequence.jsonc must contain an object');
    }
    const candidate = raw as { idleDelayMs?: unknown; steps?: unknown };
    if (typeof candidate.idleDelayMs !== 'number' || !Array.isArray(candidate.steps)) {
      throw new Error('fixtures/recharge/notify_sequence.jsonc must contain idleDelayMs and steps');
    }
    for (const step of candidate.steps) {
      if (
        typeof step !== 'object' ||
        step === null ||
        typeof (step as { atMs?: unknown }).atMs !== 'number' ||
        typeof (step as { subStatus?: unknown }).subStatus !== 'string'
      ) {
        throw new Error('fixtures/recharge/notify_sequence.jsonc steps must contain numeric atMs and string subStatus');
      }
    }
    return candidate as RechargeNotifySequence;
  });
}
