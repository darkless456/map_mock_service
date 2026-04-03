import * as THREE from 'three';

import NativeMapFrameParser from './NativeMapFrameParser';

export type MapChunkMeta = {
  timestamp_ms: number;
  resolution: number;
  origin_x: number;
  origin_y: number;
  map_cols: number;
  map_rows: number;
  rotation: number;
};

/**
 * MVP path: MQTT client delivers `ArrayBuffer` payload -> native decode -> DataTexture.
 * Replace `NativeMapFrameParser` with a JSI HostObject if you bypass TurboModule codegen.
 */
export function decodeMqttPayloadToTexture(mqttPayload: ArrayBuffer): {
  meta: MapChunkMeta;
  texture: THREE.DataTexture;
} {
  const decoded = NativeMapFrameParser.decodeIncrementFrame(mqttPayload);
  const meta = JSON.parse(decoded.metaJson) as MapChunkMeta;

  const tex = new THREE.DataTexture(
    new Uint8Array(decoded.rgba),
    decoded.width,
    decoded.height,
    THREE.RGBAFormat
  );
  tex.needsUpdate = true;
  tex.flipY = false;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.unpackAlignment = 1;

  return { meta, texture: tex };
}

/**
 * Sketch: composite an incremental orthographic tile into an atlas or FBO-backed global map.
 * - Allocate a large `WebGLRenderTarget` once (`globalRT`).
 * - Each tick: render a full-screen quad with the chunk texture using a shader that respects
 *   `meta.origin_*`, `meta.resolution`, and `meta.rotation` to place the patch in map space.
 * - `renderer.setRenderTarget(globalRT); renderer.render(compositeScene, orthoCamera);`
 * - Call `texture.dispose()` (and drop JS references) once the GPU upload is no longer needed,
 *   after the composite pass, to avoid retaining chunk textures forever.
 */
export function disposeChunkTexture(texture: THREE.DataTexture) {
  texture.dispose();
}
