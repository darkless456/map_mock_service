/**
 * FSM phase-graph descriptor — §6.7(1) `phaseGraphFromFsm()`.
 *
 * Compiles the phase enums from the read-only fsm-mirror into a lane
 * descriptor the panel client renders. Keeping the node list here (rather than
 * hardcoded in the client script) means the UI stays in sync with the FSM
 * source of truth: adding a phase to `MAPPING_PHASES` / `MowingPhase` surfaces
 * in the panel without a separate client edit.
 *
 * Lanes are ordered sequences — edges are implicit between adjacent nodes so
 * the client can render arrows + animate the incoming edge to the active node.
 */
import { MAPPING_PHASES } from './fsm-mirror/domain/mapping/MappingSession';
import { RETURN_DOCK_PHASES } from './fsm-mirror/domain/mowing/MowingTask';

export interface GraphNode {
  readonly key: string;
  readonly label: string;
}

export interface PhaseLane {
  readonly domain: 'mapping' | 'mowing';
  readonly title: string;
  readonly nodes: readonly GraphNode[];
}

export interface PhaseGraph {
  readonly lanes: readonly PhaseLane[];
}

/** Short human label for a raw phase/state key (trim the verbose prefix). */
function labelOf(key: string): string {
  return key
    .replace(/^MAP_/, '')
    .replace(/^MOW_/, 'MOW/')
    .replace(/^RETURN_/, 'RTN/')
    .replace(/^MAP_COVERAGE_/, 'COV/')
    .replace(/^MAP_FOLLOW_/, 'EDGE/')
    .replace(/^MAP_SCAN_/, 'SCAN/')
    .replace(/^MAP_BOUNDARY_/, 'BNDRY/');
}

/**
 * Build the mapping lane: task-state spine (IDLE → PREPARING → UNDOCKING →
 * WORKING) collapses onto the business-phase chain, terminating at
 * MAP_COVERAGE_DONE → COMPLETED. Remote-control / pause branches are orthogonal
 * states, not linear phases, so they are omitted from the swim-lane.
 */
function buildMappingLane(): PhaseLane {
  const nodes: GraphNode[] = [
    { key: 'IDLE', label: 'IDLE' },
    { key: 'PREPARING', label: 'PREP' },
    { key: 'UNDOCKING', label: 'UNDOCK' },
    ...MAPPING_PHASES
      .filter(phase => phase !== 'MAP_COVERAGE_DONE')
      .map(phase => ({ key: phase, label: labelOf(phase) })),
    { key: 'MAP_COVERAGE_DONE', label: 'PREVIEW' },
    { key: 'COMPLETED', label: 'DONE' },
  ];
  return { domain: 'mapping', title: 'Mapping', nodes };
}

/**
 * Build the mowing lane: IDLE → PREPARING → UNDOCKING → MOW_RUNNING →
 * return-dock sub-phases → COMPLETED. `MOW_RUNNING` is the terminal business
 * phase; the return-dock chain is the recharge descent.
 */
function buildMowingLane(): PhaseLane {
  const nodes: GraphNode[] = [
    { key: 'IDLE', label: 'IDLE' },
    { key: 'PREPARING', label: 'PREP' },
    { key: 'UNDOCKING', label: 'UNDOCK' },
    { key: 'MOW_RUNNING', label: 'MOWING' },
    ...RETURN_DOCK_PHASES
      .filter(phase => phase !== 'RETURN_DOCK_FAILED')
      .map(phase => ({ key: phase, label: labelOf(phase) })),
    { key: 'COMPLETED', label: 'DONE' },
  ];
  return { domain: 'mowing', title: 'Mowing', nodes };
}

/** Compile the full phase graph from the fsm-mirror enums (memoized). */
let cachedGraph: PhaseGraph | null = null;
export function phaseGraphFromFsm(): PhaseGraph {
  if (cachedGraph) return cachedGraph;
  cachedGraph = {
    lanes: [buildMappingLane(), buildMowingLane()],
  };
  return cachedGraph;
}

/** Serialized graph injected into the client as a JS literal. */
export const PANEL_GRAPH_JSON: string = JSON.stringify(phaseGraphFromFsm());
