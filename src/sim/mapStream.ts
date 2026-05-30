import type { MapPatch } from '../data/patches';
import { encodeMapMessageSliced } from '../ws/protocol';

export interface MapFrameOptions {
  readonly sn: string;
  readonly cmd?: 'MAP_INCREMENTAL' | 'MAP_FIX';
}

export class MapStream {
  private patchIndex = 0;
  private frameId = 0;

  constructor(private readonly patches: readonly MapPatch[]) {}

  get patchCount(): number {
    return this.patches.length;
  }

  nextFrame({ sn, cmd = 'MAP_INCREMENTAL' }: MapFrameOptions): string[] {
    if (this.patches.length === 0) return [];
    const patch = cmd === 'MAP_FIX'
      ? this.patches[0]
      : this.patches[this.patchIndex++ % this.patches.length];
    this.frameId += 1;
    return this.encodePatch(sn, patch, cmd);
  }

  fullFrame(sn: string): string[] {
    if (this.patches.length === 0) return [];
    this.frameId += 1;
    return this.encodePatch(sn, this.patches[0], 'MAP_FIX');
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
