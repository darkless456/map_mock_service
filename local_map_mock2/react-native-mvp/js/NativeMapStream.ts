import { TurboModule, TurboModuleRegistry } from 'react-native';

/**
 * Native map stream control (MQTT + decode worker). See docs/MAP_STREAM_WORKER.md.
 *
 * JS usage sketch:
 *   NativeMapStream.connect({ host, port, topic, usePaho: true });
 *   NativeMapStream.start();
 *   NativeMapStream.setStateListener((state, detail) => ...); // optional
 *   NativeMapStream.setFrameTickListener(() => {
 *     const frame = NativeMapStream.consumeLatestFrame();
 *     if (frame) { ... DataTexture ... }
 *   });
 *   NativeMapStream.pause();  // keeps MQTT, skips decode
 *   NativeMapStream.resume();
 *   NativeMapStream.stop();     // unsubscribe
 *   NativeMapStream.disconnect();
 */
export type MapStreamConnectConfig = {
  host: string;
  port: number;
  topic: string;
  clientId?: string;
  username?: string;
  password?: string;
  useTls?: boolean;
  /** When true, native should use Paho MQTTAsync (requires MAPSTREAM_WITH_PAHO). */
  usePaho?: boolean;
};

export type MapStreamStatus = {
  state: string;
  detail: string;
  sequence: number;
};

export interface Spec extends TurboModule {
  connect(config: MapStreamConnectConfig): void;
  disconnect(): void;
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  getStatus(): MapStreamStatus;
  /** Returns null if no frame yet. rgba is an ArrayBuffer view backed by native storage (see docs). */
  consumeLatestFrame(): {
    metaJson: string;
    width: number;
    height: number;
    sequence: number;
    rgba: ArrayBuffer;
  } | null;
  setStateListener(listener: (state: string, detail: string) => void): void;
  setFrameTickListener(listener: () => void): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('MapStream');
