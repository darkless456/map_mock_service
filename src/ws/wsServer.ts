import type http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import { verifyTicket } from '../auth/ticket';
import {
  buildCurrentRatelStatusPayload,
  buildMowStatus,
  buildNotifyRatelStatus,
  buildRobotLocation,
  changedPushes,
} from '../sim/pushChannels';
import type { RatelStatusPushPayload } from '../sim/ratelStatusPush';
import type { VirtualRobot, VirtualRobotSnapshot } from '../sim/virtualRobot';
import { MapStream } from '../sim/mapStream';
import type { ChaosController } from '../sim/chaos';
import type { Recorder } from '../sim/recorder';
import { OutboundHub } from './outbound';
import { handleInboundMessage } from './inbound';
import {
  advancePose,
  createPoseState,
  currentRobotPose,
  getMowingTrajectoryDebugInfo,
  resetPoseState,
  type PoseState,
} from '../data/mowingTrajectory';
import { logger } from '../shared/logger';

const DEFAULT_PUSH_INTERVAL_MS = 200;
const WS_TERMINATE_GRACE_MS = 250;

export interface WsServerRuntime {
  readonly wss: WebSocketServer;
  readonly outbound: OutboundHub;
  close(): void;
}

export interface CreateWsServerOptions {
  readonly server: http.Server;
  readonly robot: VirtualRobot;
  readonly mapStream: MapStream;
  readonly chaos: ChaosController;
  readonly recorder?: Recorder;
  readonly pushIntervalMs?: number;
}

export function createWsServer({
  server,
  robot,
  mapStream,
  chaos,
  recorder,
  pushIntervalMs = Number(process.env.PUSH_INTERVAL_MS || DEFAULT_PUSH_INTERVAL_MS),
}: CreateWsServerOptions): WsServerRuntime {
  const wss = new WebSocketServer({ noServer: true });
  const inspectWss = new WebSocketServer({ noServer: true });
  const outbound = new OutboundHub(wss, chaos, recorder);
  let pose: PoseState = createPoseState();
  let lastMowingLocationStatus: string | null = null;
  let closed = false;

  const trajectoryInfo = getMowingTrajectoryDebugInfo();
  logger.info('mowing trajectory loaded', {
    source: trajectoryInfo.source,
    pointCount: trajectoryInfo.pointCount,
    resolutionMPerPx: trajectoryInfo.resolutionMPerPx,
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname === '/sim/inspect' && process.env.SIM_PANEL !== '0') {
      inspectWss.handleUpgrade(req, socket, head, ws => inspectWss.emit('connection', ws, req));
      return;
    }
    if (url.pathname !== '/acc') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const ticket = url.searchParams.get('ticket');
    const result = verifyTicket(ticket, true);
    if (!result.valid) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    outbound.initClient(ws);
    mapStream.fullFrame(robot.sn).forEach(message => outbound.sendRaw(ws, message));
    outbound.sendJson(ws, buildNotifyRatelStatus(robot, buildCurrentRatelStatusPayload(robot)));
    const activeTask = robot.activeTask();
    if (activeTask) outbound.sendJson(ws, buildMowStatus(activeTask));

    ws.on('message', raw => handleInboundMessage(ws, raw, outbound, recorder, {
      onLocationRegister: (client, sn) => {
        const task = robot.activeTask();
        if (!task || task.status !== 'ON_THE_WAY' || task.sn !== sn) return;
        const mapId = taskMapId(task);
        outbound.sendJson(client, buildRobotLocation(sn, currentRobotPose(pose), { mapId }));
      },
    }));
    ws.on('close', () => outbound.disposeClient(ws));
    ws.on('error', () => outbound.disposeClient(ws));
  });

  inspectWss.on('connection', ws => {
    ws.send(JSON.stringify({ kind: 'hello', snapshot: robot.snapshot() }));
  });

  const onTranscript = (transcript: unknown) => {
    const message = JSON.stringify({ kind: 'transcript', transcript });
    inspectWss.clients.forEach(client => {
      if (client.readyState === client.OPEN) client.send(message);
    });
  };
  robot.on('transcript', onTranscript);

  const onRatelStatus = (payload: RatelStatusPushPayload) => {
    outbound.broadcastJson(buildNotifyRatelStatus(robot, payload));
  };
  robot.on('ratelStatus', onRatelStatus);

  const onChanged = (snapshot: VirtualRobotSnapshot) => {
    for (const payload of changedPushes(robot, snapshot)) {
      outbound.broadcastJson(payload);
    }
    if (robot.shouldStreamMap()) {
      outbound.broadcastRawMany(mapStream.nextFrame({ sn: robot.sn }));
    }
  };
  robot.on('changed', onChanged);

  const mapTimer = setInterval(() => {
    if (!robot.shouldStreamMap()) return;
    outbound.broadcastRawMany(mapStream.nextFrame({ sn: robot.sn }));
  }, pushIntervalMs);

  const locationTimer = setInterval(() => {
    const task = robot.activeTask();
    if (!task) {
      lastMowingLocationStatus = null;
      return;
    }
    if (task.status !== 'ON_THE_WAY') {
      lastMowingLocationStatus = task.status;
      return;
    }
    if (lastMowingLocationStatus !== 'ON_THE_WAY') {
      resetPoseState(pose);
    }
    lastMowingLocationStatus = 'ON_THE_WAY';
    const mapId = taskMapId(task);
    const current = advancePose(pose);
    outbound.broadcastLocation(task.sn, buildRobotLocation(task.sn, current, { mapId }));
  }, 300);

  const mowTimer = setInterval(() => {
    const task = robot.activeTask();
    if (!task || task.status !== 'ON_THE_WAY') return;
    robot.progressMowing(2);
    const updated = robot.activeTask();
    if (updated) outbound.broadcastJson(buildMowStatus(updated));
  }, 5000);

  return {
    wss,
    outbound,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(mapTimer);
      clearInterval(locationTimer);
      clearInterval(mowTimer);
      robot.off('changed', onChanged);
      robot.off('transcript', onTranscript);
      robot.off('ratelStatus', onRatelStatus);
      closeWebSocketClients(wss);
      closeWebSocketClients(inspectWss);
      wss.close();
      inspectWss.close();
    },
  };
}

function taskMapId(task: { task_info?: Record<string, unknown> }): string {
  const mapId = task.task_info?.map_id;
  return typeof mapId === 'string' && mapId.length > 0 ? mapId : 'mock_map_001';
}

function closeWebSocketClients(server: WebSocketServer): void {
  server.clients.forEach(client => {
    if (client.readyState === client.CLOSED) return;
    client.close(1001, 'simulator shutting down');
    const terminateTimer = setTimeout(() => {
      if (client.readyState !== client.CLOSED) client.terminate();
    }, WS_TERMINATE_GRACE_MS);
    terminateTimer.unref?.();
  });
}
