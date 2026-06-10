import zlib from 'node:zlib';
import { createId } from '../shared/ids';
import { crc32 } from '../shared/crc';

const FORCE_SLICE_BYTES = (() => {
  const raw = process.env.MMR_SLICE_BYTES || process.env.MAP_MOCK_SLICE_BYTES;
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
})();

// 真实后端的建图增量帧只做 base64，不做 gzip 压缩。Mock 默认保持一致（不压缩），
// 仅当显式设置 MMR_GZIP=1 / MAP_MOCK_GZIP=1 时才启用 gzip，用于回归测试压缩解码路径。
const GZIP_MAP_DATA = (() => {
  const raw = process.env.MMR_GZIP || process.env.MAP_MOCK_GZIP;
  return raw === '1' || raw === 'true';
})();

export interface MapHeaderFields {
  readonly version?: number;
  readonly msgType?: number;
  readonly timestampSec?: number;
  readonly timestampNsec?: number;
  readonly width: number;
  readonly height: number;
  readonly resolution: number;
  readonly originX: number;
  readonly originY: number;
  readonly robotX?: number;
  readonly robotY?: number;
  readonly robotTheta?: number;
  readonly mapId?: number;
  readonly frameId?: number;
  readonly frameSlicingTotal?: number;
  readonly frameSlicingId?: number;
  readonly frameSlicingIndex?: number;
  /** 建图面积（m²）；缺省时按 `width × height × resolution²` 估算 */
  readonly lawnArea?: number;
}

/** `ratel_backend_api.md` §3.1 `map_header.lawn_area` */
export function estimateLawnAreaM2(
  width: number,
  height: number,
  resolution: number,
): number {
  const area = width * height * resolution * resolution;
  return Math.round(area * 10) / 10;
}

export interface EncodeMapMessageOptions {
  readonly sn: string;
  readonly headerFields: MapHeaderFields;
  readonly imageBytes: Buffer;
  readonly cmdId?: string;
  readonly cmd?: string;
}

export function encodeMapData(rawBuffer: Buffer): string {
  const payload = GZIP_MAP_DATA ? zlib.gzipSync(rawBuffer) : rawBuffer;
  return payload.toString('base64');
}

function baseHeader(headerFields: MapHeaderFields, imageBytes: Buffer) {
  return {
    version: headerFields.version ?? 1,
    header_len: 36,
    data_len: imageBytes.length,
    msg_type: headerFields.msgType ?? 2,
    timestamp_sec: headerFields.timestampSec ?? Math.floor(Date.now() / 1000),
    timestamp_nsec: headerFields.timestampNsec ?? 0,
    width: headerFields.width,
    height: headerFields.height,
    resolution: headerFields.resolution,
    origin_x: headerFields.originX,
    origin_y: headerFields.originY,
    robot_x: headerFields.robotX ?? 0,
    robot_y: headerFields.robotY ?? 0,
    robot_theta: headerFields.robotTheta ?? 0,
    format: 'png',
    map_id: headerFields.mapId ?? 0,
    frame_id: headerFields.frameId ?? 0,
    frame_slicing_total: headerFields.frameSlicingTotal ?? 1,
    frame_slicing_id: headerFields.frameSlicingId ?? 0,
    frame_slicing_index: headerFields.frameSlicingIndex ?? 0,
    crc32: crc32(imageBytes),
    lawn_area:
      headerFields.lawnArea ??
      estimateLawnAreaM2(
        headerFields.width,
        headerFields.height,
        headerFields.resolution,
      ),
  };
}

export function encodeMapMessage({
  sn,
  headerFields,
  imageBytes,
  cmdId,
  cmd,
}: EncodeMapMessageOptions): string {
  return JSON.stringify({
    cmd: cmd ?? 'MAP_INCREMENTAL',
    cmd_id: cmdId ?? createId(),
    version: 1,
    data: {
      sn,
      map_header: baseHeader(headerFields, imageBytes),
      map_data: encodeMapData(imageBytes),
    },
  });
}

export function splitBase64IntoDecodableChunks(base64: string, chunkChars: number): string[] {
  const safeChunkChars = Math.max(4, Math.floor(chunkChars / 4) * 4);
  if (chunkChars <= 0 || base64.length <= safeChunkChars) return [base64];
  const out: string[] = [];
  for (let i = 0; i < base64.length; i += safeChunkChars) {
    out.push(base64.slice(i, i + safeChunkChars));
  }
  return out;
}

export function encodeMapMessageSliced(opts: EncodeMapMessageOptions): string[] {
  if (FORCE_SLICE_BYTES <= 0) return [encodeMapMessage(opts)];
  const callerDeclaredSlicing =
    opts.headerFields.frameSlicingTotal !== undefined ||
    opts.headerFields.frameSlicingIndex !== undefined;
  if (callerDeclaredSlicing) return [encodeMapMessage(opts)];

  const cmdId = opts.cmdId ?? createId();
  const cmd = opts.cmd ?? 'MAP_INCREMENTAL';
  const mapData = encodeMapData(opts.imageBytes);
  const chunks = splitBase64IntoDecodableChunks(mapData, FORCE_SLICE_BYTES);
  if (chunks.length <= 1) return [encodeMapMessage({ ...opts, cmdId, cmd })];

  const header = baseHeader(opts.headerFields, opts.imageBytes);
  return chunks.map((chunk, index) => JSON.stringify({
    cmd,
    cmd_id: cmdId,
    version: 1,
    data: {
      sn: opts.sn,
      map_header: {
        ...header,
        frame_slicing_total: chunks.length,
        frame_slicing_index: index,
      },
      map_data: chunk,
    },
  }));
}

export function isClientFrameAck(msg: unknown): boolean {
  if (typeof msg !== 'object' || msg === null) return false;
  const data = (msg as { data?: unknown }).data;
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { code?: unknown }).code === 200 &&
    ((data as { msg?: unknown }).msg === 'success' ||
      (data as { result?: unknown }).result === 'SUCCESS')
  );
}
