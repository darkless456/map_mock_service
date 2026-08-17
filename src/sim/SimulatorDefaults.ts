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
 * Mirror the Mower debug default: scenarios may directly push manual mapping phases.
 * The Mower client owns whether those pushes advance its UI.
 */
export const MANUAL_SCAN_START_GATE_REQUIRED = false;

/**
 * mapping-v4-final-spec.md §7: dataset `EXPAND_AREA` switches `mapStream` to. All lawns
 * beyond the first reuse this same fixture (its own visual content isn't load-bearing — the
 * "which lawn number" signal is carried entirely by the §5 `labels` count, not by dataset
 * identity), so there is no `mapping_lawn3_aisle` etc.
 */
export const EXPAND_AREA_DATASET = 'mapping_lawn2_aisle';

/** mapping-v4-final-spec.md §5: "添加草坪" disabled once `edge_start` label count reaches this. */
export const EXPAND_AREA_MAX_LAWNS = 15;

/**
 * APP端接口文档 §9.1「发起地图扩展」：PuduLink 下发 `RATEL_MAPPING_TASK_EXPANSION` 后**同步
 * 等待设备回包**才响应，所以 mock 也不瞬时返回 200。数值本身不由规格规定。
 */
export const MAPPING_EXPANSION_ACK_DELAY_MS = 250;

/**
 * §9.1「接口成功仅表示设备已确认指令，扩展进度和最终结果以设备后续状态上报为准」——设备确认
 * 后自行推进的 `sub_status` 序列延迟。Mower 侧 `useAddLawnFromMapEdit` 挂起等待 FSM 进入活跃态
 * （`UNDOCKING`/`WORKING`/`REMOTE_CONTROL`/…）才跳转建图页，且只推 `precondition` 会停在
 * `PREPARING`，因此 `leave_dock` 是必须的第二帧。
 *
 * 两个延迟都必须**远小于** Mower 的 `START_STATUS_WATCHDOG_MS`（12s）：超时后 App 会判定启动
 * 失败并复位会话，「添加草坪」表现为点了没反应。
 */
export const MAPPING_EXPANSION_UNDOCK_DELAY_MS = 1_500;
export const MAPPING_EXPANSION_FIND_BOUNDARY_DELAY_MS = 4_000;

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
