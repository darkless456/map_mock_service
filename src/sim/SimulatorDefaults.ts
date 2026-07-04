import type { TaskContext } from './fsm-mirror/domain/shared/TaskFSM';
import type { SimCapabilities, SimView } from './simFsmTypes';

const DEFAULT_SIM_CAPABILITIES: SimCapabilities = {
  canSwitchManual: false,
  canSwitchAuto: false,
};

export function withSimulatorDefaults<P extends string>(
  ctx: TaskContext<P>,
  battery: number,
): SimView<P> {
  return {
    ...ctx,
    battery,
    capabilities: DEFAULT_SIM_CAPABILITIES,
    notices: [],
  };
}
