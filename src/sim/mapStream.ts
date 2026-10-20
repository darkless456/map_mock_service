import { loadAllPatches, type MapPatch } from '../assets/PatchLoader';
import { logger } from '../infra/logger';
import { encodeMapMessageSliced, estimateLawnAreaM2 } from '../ws/protocol';

export type DatasetSwitchResult =
  | { readonly ok: true; readonly name: string; readonly patchCount: number }
  | { readonly ok: false; readonly error: string };

/**
 * Shared `switchDataset` closure factory — used by `server.ts` (fault/scenario dependency
 * injection) and `mappingTask.routes.ts` (`EXPAND_AREA`, mapping-v4-final-spec.md §7) so both
 * call sites drive the same `MapStream` instance through one code path.
 */
export function createDatasetSwitcher(mapStream: MapStream): (name: string) => DatasetSwitchResult {
  return (name: string) => {
    const nextPatches = loadAllPatches(name);
    if (nextPatches.length === 0) return { ok: false, error: `dataset not found or empty: ${name}` };
    mapStream.switchDataset(name, nextPatches);
    logger.info(`Switched map dataset to ${name} (${nextPatches.length} patches)`);
    return { ok: true, name, patchCount: nextPatches.length };
  };
}

export interface MapFrameOptions {
  readonly sn: string;
  readonly cmd?: 'MAP_INCREMENTAL' | 'MAP_FIX';
}

export interface MapStreamRobotPose {
  readonly x: number;
  readonly y: number;
  readonly theta: number;
}

export class MapStream {
  private patchIndex = 0;
  private frameId = 0;
  /** Last patch dispatched by {@link nextFrame}; used for ROBOT_LOCATION during mapping. */
  private currentPatch: MapPatch | null = null;

  constructor(
    private patches: readonly MapPatch[],
    private datasetName = 'custom',
  ) {}

  get dataset(): string {
    return this.datasetName;
  }

  get patchCount(): number {
    return this.patches.length;
  }

  /** Same geometry source used by MAP_INCREMENTAL.map_header.lawn_area. */
  get lawnArea(): number | null {
    const patch = this.patches[0];
    return patch ? estimateLawnAreaM2(patch.mapCols, patch.mapRows, patch.resolution) : null;
  }

  switchDataset(name: string, patches: readonly MapPatch[]): void {
    this.datasetName = name;
    this.patches = patches;
    this.patchIndex = 0;
    this.frameId = 0;
    this.currentPatch = null;
  }

  nextFrame({ sn, cmd = 'MAP_INCREMENTAL' }: MapFrameOptions): string[] {
    if (this.patches.length === 0) return [];
    const patch = cmd === 'MAP_FIX'
      ? this.patches[0]
      : this.patches[this.patchIndex++ % this.patches.length];
    this.currentPatch = patch;
    this.frameId += 1;
    return this.encodePatch(sn, patch, cmd);
  }

  fullFrame(sn: string): string[] {
    if (this.patches.length === 0) return [];
    this.currentPatch = this.patches[0];
    this.frameId += 1;
    return this.encodePatch(sn, this.patches[0], 'MAP_FIX');
  }

  /**
   * 当前帧的机器人位姿（来自 PatchLoader 计算的地图栅格中心 + 朝向）。
   * 建图期间 {@link wsServer.locationTimer} 用它推 ROBOT_LOCATION，
   * 使 App 的 RobotMotionController 有位置驱动动画。
   */
  currentRobotPose(): MapStreamRobotPose | null {
    const patch = this.currentPatch ?? this.patches[0];
    if (!patch) return null;
    return { x: patch.robotX, y: patch.robotY, theta: patch.robotTheta };
  }

  private encodePatch(sn: string, patch: MapPatch, cmd: 'MAP_INCREMENTAL' | 'MAP_FIX'): string[] {
    const sec = Math.floor(patch.timestampMs / 1000);
    const nsec = Math.round((patch.timestampMs % 1000) * 1e6);
    return encodeMapMessageSliced({
      sn,
      cmd,
      imageBytes: patch.imageData,
      headerFields: {
        msgType: 2,
        timestampSec: sec >>> 0,
        timestampNsec: nsec >>> 0,
        width: patch.mapCols,
        height: patch.mapRows,
        originX: patch.originX,
        originY: patch.originY,
        resolution: patch.resolution,
        robotX: patch.robotX,
        robotY: patch.robotY,
        robotTheta: patch.robotTheta,
        frameId: this.frameId,
      },
    });
  }
}
