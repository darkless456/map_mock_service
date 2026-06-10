import type WebSocket from 'ws';
import type { WebSocketServer } from 'ws';
import type { ChaosController } from '../sim/chaos';
import type { Recorder } from '../sim/recorder';

export class OutboundHub {
  private readonly locationSubs = new WeakMap<WebSocket, Set<string>>();

  constructor(
    private readonly wss: WebSocketServer,
    private readonly chaos: ChaosController,
    private readonly recorder?: Recorder,
  ) {}

  initClient(ws: WebSocket): void {
    this.locationSubs.set(ws, new Set());
  }

  disposeClient(ws: WebSocket): void {
    this.locationSubs.delete(ws);
  }

  registerLocation(ws: WebSocket, sn: string): void {
    this.locationSubs.get(ws)?.add(sn);
  }

  unregisterLocation(ws: WebSocket, sn: string): void {
    this.locationSubs.get(ws)?.delete(sn);
  }

  sendJson(ws: WebSocket, payload: unknown): void {
    this.recorder?.recordWsOut(payload);
    this.sendRaw(ws, JSON.stringify(payload));
  }

  sendRaw(ws: WebSocket, message: string): void {
    if (ws.readyState !== ws.OPEN) return;
    this.chaos.send(() => {
      if (ws.readyState === ws.OPEN) ws.send(message);
    });
  }

  broadcastJson(payload: unknown): void {
    this.recorder?.recordWsOut(payload);
    const message = JSON.stringify(payload);
    this.broadcastRaw(message);
  }

  broadcastRaw(message: string): void {
    this.wss.clients.forEach(client => {
      this.sendRaw(client, message);
    });
  }

  broadcastRawMany(messages: readonly string[]): void {
    for (const message of messages) this.broadcastRaw(message);
  }

  broadcastLocation(sn: string, payload: unknown): void {
    const message = JSON.stringify(payload);
    this.wss.clients.forEach(client => {
      const subs = this.locationSubs.get(client);
      if (subs?.has(sn)) this.sendRaw(client, message);
    });
  }

  /** 诊断：当前对某 sn 已登记的订阅者数量。 */
  locationSubscriberCount(sn: string): number {
    let count = 0;
    this.wss.clients.forEach(client => {
      if (this.locationSubs.get(client)?.has(sn)) count += 1;
    });
    return count;
  }
}
