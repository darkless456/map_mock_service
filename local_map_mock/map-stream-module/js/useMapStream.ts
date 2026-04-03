/**
 * @file useMapStream.ts
 * @brief React hook for managing the C++ MQTT map streaming lifecycle.
 *
 * Usage:
 *   const { state, connect, start, stop, pause, resume, disconnect } = useMapStream({
 *     brokerUrl: 'ws://192.168.1.100',
 *     port: 8883,
 *     onFrame: (frame) => renderer.applyFragment(frame),
 *   });
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MapStream,
  isNativeMapStreamAvailable,
  type StreamState,
  type MqttConfig,
  type DecodedFrame,
} from '../native/mapStreamBridge';

export interface UseMapStreamOptions {
  /** MQTT broker URL — required */
  brokerUrl: string;
  /** MQTT broker port (default: 1883 for TCP, 8883 for WS) */
  port?: number;
  /** MQTT topic (default: "robot/map/increment") */
  topic?: string;
  /** Client ID (default: "rn-map-client") */
  clientId?: string;
  /**
   * Called on JS thread when a new decoded frame is available.
   * The frame's rgbaBuffer is zero-copy from C++ — no memcpy overhead.
   */
  onFrame?: (frame: DecodedFrame) => void;
  /** Auto-connect on mount (default: false) */
  autoConnect?: boolean;
  /** Auto-start streaming after connection (default: false) */
  autoStart?: boolean;
}

export function useMapStream(options: UseMapStreamOptions) {
  const {
    brokerUrl,
    port,
    topic,
    clientId,
    onFrame,
    autoConnect = false,
    autoStart = false,
  } = options;

  const [state, setState] = useState<StreamState>('Disconnected');
  const [error, setError] = useState<string>('');
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const autoStartRef = useRef(autoStart);
  autoStartRef.current = autoStart;

  // ── Lifecycle: register callbacks & cleanup ───────────────────────
  useEffect(() => {
    if (!isNativeMapStreamAvailable()) {
      console.warn('[useMapStream] Native MapStreamModule not available');
      return;
    }

    // State change callback (fires from C++ → JS thread)
    MapStream.onStateChange((newState, detail) => {
      setState(newState);
      if (newState === 'Error') {
        setError(detail);
      } else {
        setError('');
      }
      // Auto-start on connect
      if (newState === 'Connected' && autoStartRef.current) {
        MapStream.start();
      }
    });

    // Frame ready callback (fires from C++ decode thread → JS thread)
    MapStream.onFrameReady(() => {
      const frame = MapStream.acquireFrame();
      if (frame && onFrameRef.current) {
        onFrameRef.current(frame);
      }
    });

    // Cleanup on unmount: tear down everything
    return () => {
      MapStream.onStateChange(null);
      MapStream.onFrameReady(null);
      MapStream.disconnect();
    };
  }, []);

  // ── API ───────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    const config: MqttConfig = { brokerUrl };
    if (port !== undefined) config.port = port;
    if (topic !== undefined) config.topic = topic;
    if (clientId !== undefined) config.clientId = clientId;
    return MapStream.connect(config);
  }, [brokerUrl, port, topic, clientId]);

  const start     = useCallback(() => MapStream.start(), []);
  const stop      = useCallback(() => MapStream.stop(), []);
  const pause     = useCallback(() => MapStream.pause(), []);
  const resume    = useCallback(() => MapStream.resume(), []);
  const disconnect = useCallback(() => MapStream.disconnect(), []);

  // ── Auto-connect ──────────────────────────────────────────────────
  useEffect(() => {
    if (autoConnect && isNativeMapStreamAvailable()) {
      connect();
    }
  }, [autoConnect, connect]);

  return {
    state,
    error,
    connect,
    start,
    stop,
    pause,
    resume,
    disconnect,
    /** Manual frame pull (for polling patterns instead of callback) */
    acquireFrame: MapStream.acquireFrame,
  };
}
