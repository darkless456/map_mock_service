/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/cloudWorkStatus.ts. DO NOT EDIT. !!!
// Source SHA-256: 5a50e2761ee0f187eed21c19cbb927cb9047d617a26caa648fdb9adb383ccd53
// Synced at: 2026-06-02T09:43:38.803Z
/**
 * Cloud `NOTIFY_RATEL_STATUS.data.work_status` — authoritative WS enum from gateway.
 * Do not confuse with `RatelRunState` / BLE `running_status` (more values).
 */

export const CLOUD_WS_WORK_STATUSES = [
  'idle',
  'mowing',
  'charging',
  'mapping',
  'error',
] as const;

export type CloudWsWorkStatus = (typeof CLOUD_WS_WORK_STATUSES)[number];

const CLOUD_WS_WORK_STATUS_SET: ReadonlySet<string> = new Set(CLOUD_WS_WORK_STATUSES);

export function isCloudWsWorkStatus(value: string): value is CloudWsWorkStatus {
  return CLOUD_WS_WORK_STATUS_SET.has(value);
}

/**
 * App/BLE legacy coarse status not sent on cloud WS.
 * Completion on cloud: `exit_mapping` (sub_status) then `work_status: idle`.
 */
export const LEGACY_WORK_STATUSES = ['mapping_completed'] as const;
