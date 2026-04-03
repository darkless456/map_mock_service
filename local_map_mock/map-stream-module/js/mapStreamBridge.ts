/**
 * @file mapStreamBridge.ts
 * @brief Type definitions and thin wrappers for the C++ MapStreamModule JSI functions.
 *
 * The C++ module installs global functions (mapStream_*) on the JSI runtime.
 * This file provides typed access and a clean API surface for React components.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type StreamState =
  | 'Disconnected'
  | 'Connecting'
  | 'Connected'
  | 'Subscribing'
  | 'Streaming'
  | 'Paused'
  | 'Error';

export interface MqttConfig {
  brokerUrl: string;   // e.g. "tcp://192.168.1.100" or "ws://192.168.1.100"
  port?: number;       // default 1883
  topic?: string;      // default "robot/map/increment"
  clientId?: string;   // default "rn-map-client"
}

export interface MapMetadata {
  timestamp_ms: number;
  resolution: number;
  origin_x: number;
  origin_y: number;
  map_cols: number;
  map_rows: number;
  seq: number;
}

export interface DecodedFrame {
  metadata: MapMetadata;
  /** RGBA raw pixel data: metadata.map_cols * metadata.map_rows * 4 bytes */
  rgbaBuffer: ArrayBuffer;
}

export type StateChangeCallback = (state: StreamState, detail: string) => void;
export type FrameReadyCallback = () => void;

// ─── Global JSI function declarations ────────────────────────────────────────

declare global {
  function mapStream_connect(config: MqttConfig): Promise<boolean>;
  function mapStream_start(): boolean;
  function mapStream_stop(): boolean;
  function mapStream_pause(): boolean;
  function mapStream_resume(): boolean;
  function mapStream_disconnect(): void;
  function mapStream_getState(): string;
  function mapStream_acquireFrame(): DecodedFrame | null;
  function mapStream_setOnStateChange(cb: StateChangeCallback | null): void;
  function mapStream_setOnFrameReady(cb: FrameReadyCallback | null): void;
}

// ─── Typed API wrapper ──────────────────────────────────────────────────────

/**
 * Check if the native C++ module is available.
 * Returns false in development / web environments.
 */
export function isNativeMapStreamAvailable(): boolean {
  return typeof globalThis.mapStream_connect === 'function';
}

export const MapStream = {
  connect:    (config: MqttConfig) => mapStream_connect(config),
  start:      ()                   => mapStream_start(),
  stop:       ()                   => mapStream_stop(),
  pause:      ()                   => mapStream_pause(),
  resume:     ()                   => mapStream_resume(),
  disconnect: ()                   => mapStream_disconnect(),
  getState:   ()                   => mapStream_getState() as StreamState,

  /**
   * Non-blocking frame acquisition from the triple-buffer.
   * Returns null if no new frame is available since last call.
   *
   * Memory note: the returned rgbaBuffer ArrayBuffer is backed by C++
   * memory (zero-copy). It remains valid as long as JS holds a reference.
   * Once GC'd, the underlying C++ vector is freed automatically.
   */
  acquireFrame: () => mapStream_acquireFrame() as DecodedFrame | null,

  onStateChange: (cb: StateChangeCallback | null) => mapStream_setOnStateChange(cb),
  onFrameReady:  (cb: FrameReadyCallback | null)  => mapStream_setOnFrameReady(cb),
} as const;
