import type http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import { verifyTicket } from '../auth/ticket';
import { buildMowStatus, buildRobotLocation, buildRobotStatus, changedPushes } from '../sim/pushChannels';
import type { VirtualRobot, VirtualRobotSnapshot } from '../sim/virtualRobot';
import { MapStream } from '../sim/mapStream';
import type { ChaosController } from '../sim/chaos';
import type { Recorder } from '../sim/recorder';
import { OutboundHub } from './outbound';
import { handleInboundMessage } from './inbound';

const DEFAULT_PUSH_INTERVAL_MS = 200;

const MOW_FIELD_X1 = 10.8;
const MOW_FIELD_X2 = 14.0;
const MOW_FIELD_Y1 = 10.0;
const MOW_FIELD_Y2 = 14.6;
const MOW_WIDTH_M = 0.4;
const ROBOT_STEP_M = 0.1;
const NO_GO_BOX = { minX: 12.0, maxX: 13.0, minY: 12.2, maxY: 13.2 };

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
  const pose = createPoseState();

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
    outbound.sendJson(ws, buildRobotStatus(robot));
    const activeTask = robot.activeTask();
    if (activeTask) outbound.sendJson(ws, buildMowStatus(activeTask));

    ws.on('message', raw => handleInboundMessage(ws, raw, outbound, recorder));
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

  const onChanged = (snapshot: VirtualRobotSnapshot) => {
    for (const payload of changedPushes(robot, snapshot)) {
      outbound.broadcastJson(payload);
    }
  };
  robot.on('changed', onChanged);

  const mapTimer = setInterval(() => {
    if (!robot.shouldStreamMap()) return;
    outbound.broadcastRawMany(mapStream.nextFrame({ sn: robot.sn }));
  }, pushIntervalMs);

  const locationTimer = setInterval(() => {
    const task = robot.activeTask();
    if (!task || task.status !== 'ON_THE_WAY') return;
    const current = advancePose(pose);
    outbound.broadcastLocation(task.sn, buildRobotLocation(task.sn, current));
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
      clearInterval(mapTimer);
      clearInterval(locationTimer);
      clearInterval(mowTimer);
      robot.off('changed', onChanged);
      robot.off('transcript', onTranscript);
      wss.close();
      inspectWss.close();
    },
  };
}

interface PoseState {
  x: number;
  y: number;
  goingRight: boolean;
}

function createPoseState(): PoseState {
  return { x: MOW_FIELD_X1, y: MOW_FIELD_Y1, goingRight: true };
}

function advancePose(pose: PoseState): { x: number; y: number; angle: number } {
  const dx = pose.goingRight ? ROBOT_STEP_M : -ROBOT_STEP_M;
  pose.x += dx;

  if (
    pose.x >= NO_GO_BOX.minX &&
    pose.x <= NO_GO_BOX.maxX &&
    pose.y >= NO_GO_BOX.minY &&
    pose.y <= NO_GO_BOX.maxY
  ) {
    pose.x = pose.goingRight ? NO_GO_BOX.maxX + ROBOT_STEP_M : NO_GO_BOX.minX - ROBOT_STEP_M;
  }

  if (pose.goingRight && pose.x >= MOW_FIELD_X2) {
    pose.x = MOW_FIELD_X2;
    pose.y += MOW_WIDTH_M;
    pose.goingRight = false;
  } else if (!pose.goingRight && pose.x <= MOW_FIELD_X1) {
    pose.x = MOW_FIELD_X1;
    pose.y += MOW_WIDTH_M;
    pose.goingRight = true;
  }

  if (pose.y > MOW_FIELD_Y2) {
    pose.x = MOW_FIELD_X1;
    pose.y = MOW_FIELD_Y1;
    pose.goingRight = true;
  }

  return { x: pose.x, y: pose.y, angle: pose.goingRight ? 0 : Math.PI };
}
