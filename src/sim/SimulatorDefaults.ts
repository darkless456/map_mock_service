import type { TaskContext } from './fsm-mirror/domain/shared/TaskFSM';
import type { SimCapabilities, SimView } from './simFsmTypes';

const DEFAULT_SIM_CAPABILITIES: SimCapabilities = {
  canSwitchManual: false,
  canSwitchAuto: false,
};

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
