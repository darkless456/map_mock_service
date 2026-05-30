import type WebSocket from 'ws';
import { isClientFrameAck } from './protocol';
import type { OutboundHub } from './outbound';
import type { Recorder } from '../sim/recorder';

export function handleInboundMessage(ws: WebSocket, raw: WebSocket.RawData, outbound: OutboundHub, recorder?: Recorder): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw.toString()) as Record<string, unknown>;
  } catch {
    return;
  }
  recorder?.recordWsIn(msg.cmd, msg.data);

  if (isClientFrameAck(msg)) {
    outbound.sendJson(ws, {
      cmd: msg.cmd,
      cmd_id: msg.cmd_id,
      version: 1,
      data: { code: 200, codeMsg: 'Success' },
    });
    return;
  }

  if (msg.cmd === 'heartbeat') {
    outbound.sendJson(ws, {
      cmd: 'heartbeat',
      cmd_id: msg.cmd_id,
      version: 1,
      data: { code: 200, codeMsg: 'Success', data: {} },
    });
    return;
  }

  if (msg.cmd === 'ping') {
    outbound.sendJson(ws, {
      cmd: 'ping',
      cmd_id: msg.cmd_id,
      version: 1,
      data: { code: 200, codeMsg: 'Success', data: 'pong' },
    });
    return;
  }

  if (msg.cmd === 'LOCATION_REGISTER' || msg.cmd === 'LOCATION_UNREGISTER') {
    const data = msg.data;
    const sn = typeof data === 'object' && data !== null
      ? (data as { sn?: unknown }).sn
      : undefined;
    if (typeof sn !== 'string' || !sn) return;
    if (msg.cmd === 'LOCATION_REGISTER') outbound.registerLocation(ws, sn);
    else outbound.unregisterLocation(ws, sn);
  }
}
