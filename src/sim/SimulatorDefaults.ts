import type { TaskContext } from './fsm-mirror/domain/shared/TaskFSM';
import type { SimCapabilities, SimView } from './simFsmTypes';

const DEFAULT_SIM_CAPABILITIES: SimCapabilities = {
  canSwitchManual: false,
  canSwitchAuto: false,
};

/**
 * mapping-v4-final-spec.md §1: `EDGE_START`/`EDGE_CLOSE` acceptance ("设备受理请求") must not
 * synchronously flip `sub_status` — the authoritative transition arrives as a later, separate
 * device push. The exact delay isn't spec-mandated (a "value", not structure/channel, per
 * Appendix A), so the mock schedules a short async ack to keep the flow self-driving.
 */
export const MAPPING_ACTION_ACK_DELAY_MS = 800;

/** mapping-v4-final-spec.md §3: `MAP_COMPLETING` countdown before auto-COMPLETE. */
export const MAP_COMPLETING_DURATION_MS = 120_000;

/**
 * mapping-v4-final-spec.md §7: dataset `EXPAND_AREA` switches `mapStream` to. All lawns
 * beyond the first reuse this same fixture (its own visual content isn't load-bearing — the
 * "which lawn number" signal is carried entirely by the §5 `labels` count, not by dataset
 * identity), so there is no `mapping_lawn3_aisle` etc.
 */
export const EXPAND_AREA_DATASET = 'mapping_lawn2_aisle';

/** mapping-v4-final-spec.md §5: "添加草坪" disabled once `edge_start` label count reaches this. */
export const EXPAND_AREA_MAX_LAWNS = 15;

export function withSimulatorDefaults<P extends string, T extends TaskContext<P>>(
  ctx: T,
  battery: number,
): T & SimView<P> {
  return {
    ...ctx,
    battery,
    capabilities: DEFAULT_SIM_CAPABILITIES,
    notices: [],
  } as T & SimView<P>;
}
