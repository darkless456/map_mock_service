/**
 * useMapDecoder.ts — JS-side hook to call the C++ JSI decodeMapFrame function.
 *
 * The global `decodeMapFrame` is installed by MapDecoderModule::install() in C++.
 */

export interface MapMetadata {
  timestamp_ms: number;
  resolution: number;
  origin_x: number;
  origin_y: number;
  map_cols: number;
  map_rows: number;
  seq: number;
}

export interface DecodedMapFrame {
  metadata: MapMetadata;
  rgbaBuffer: ArrayBuffer;
}

/**
 * Global JSI function injected by C++ TurboModule.
 * Decodes binary MQTT frame → { metadata, rgbaBuffer(RGBA raw pixels) }
 */
declare global {
  function decodeMapFrame(buffer: ArrayBuffer): Promise<DecodedMapFrame>;
}

/**
 * Parse MQTT binary frame in pure JS (fallback / dev WebSocket mode).
 * Frame: [4B json_len BE] + [json UTF-8] + [PNG binary]
 *
 * In production, use the C++ JSI path for zero-copy PNG decode.
 * This JS fallback is for debugging with pre-decoded textures.
 */
export function parseMqttFrame(buffer: ArrayBuffer): {
  metadata: MapMetadata;
  pngData: Uint8Array;
} {
  const view = new DataView(buffer);
  const jsonLen = view.getUint32(0, false); // big-endian
  const jsonBytes = new Uint8Array(buffer, 4, jsonLen);
  const jsonStr = new TextDecoder().decode(jsonBytes);
  const metadata: MapMetadata = JSON.parse(jsonStr);
  const pngData = new Uint8Array(buffer, 4 + jsonLen);
  return { metadata, pngData };
}
