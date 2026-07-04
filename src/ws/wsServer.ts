import type http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import { verifyTicket } from '../auth/ticket';
import {
  buildCurrentRatelStatusPayload,
  buildMappingTaskStatus,
  buildMowStatus,
  buildNotifyRatelStatus,
  buildRecharge,
  buildRobotLocation,
  changedPushes,
} from '../sim/pushChannels';
import type { RatelStatusPushPayload } from '../sim/ratelStatusPush';
import type { RechargeStatusPush, VirtualRobot, VirtualRobotSnapshot } from '../sim/virtualRobot';
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
} from '../trajectory/mowingTrajectory';
import { logger } from '../infra/logger';

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
    // 模拟器健壮性：连接即自动订阅当前机器人 SN 的位置流。
    // 真机 / 线上后端要求显式 LOCATION_REGISTER，但部分客户端（如本 POC 的 RN 集成）
    // 的原生 wsSend 上行可能不可靠，导致 LOCATION_REGISTER 到不了服务端、收不到
    // ROBOT_LOCATION。作为开发模拟器，这里默认把每个连接登记为位置订阅者，保证只要
    // 任务 ON_THE_WAY 机器人就会动；客户端显式 LOCATION_REGISTER/UNREGISTER 仍照常生效。
    outbound.registerLocation(ws, robot.sn);
    logger.info('client connected → auto-subscribed location', { robotSn: robot.sn });
    mapStream.fullFrame(robot.sn).forEach(message => outbound.sendRaw(ws, message));
    outbound.sendJson(ws, buildNotifyRatelStatus(robot, buildCurrentRatelStatusPayload(robot)));
    const activeTask = robot.activeTask();
    // 仅在任务处于活跃态时向新连接补发 NOTIFY_MOW_STATUS。
    // 终态任务（COMPLETE/CANCEL/FAILED）会让 App 割草页直接进入 finished，
    // 阻断「底图就绪 → REST 建任务 → LOCATION_REGISTER」的自动握手，
    // 导致重新进入割草页后收不到 ROBOT_LOCATION、机器人与轨迹都不刷新。
    if (activeTask && (activeTask.status === 'ON_THE_WAY' || activeTask.status === 'PAUSE')) {
      outbound.sendJson(ws, buildMowStatus(activeTask));
    }
    // 同上：新连接补发建图任务级状态（RATEL_MAPPING_TASK），仅在存在活跃任务时补发，
    // 供 App 侧断线重连后的任务对齐（建图任务 API 重构方案 §6.2）。
    const activeMappingTask = robot.activeMappingTask();
    if (activeMappingTask && (activeMappingTask.status === 'ON_THE_WAY' || activeMappingTask.status === 'PAUSE')) {
      outbound.sendJson(ws, buildMappingTaskStatus(activeMappingTask));
    }

    ws.on('message', raw => handleInboundMessage(ws, raw, outbound, recorder, {
      onLocationRegister: (client, sn) => {
        const task = robot.activeTask();
        logger.info('LOCATION_REGISTER received', {
          registerSn: sn,
          robotSn: robot.sn,
          snMatchesRobot: sn === robot.sn,
          hasActiveTask: !!task,
          taskSn: task?.sn ?? null,
          taskStatus: task?.status ?? null,
          subscriberCount: outbound.locationSubscriberCount(sn),
        });
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

  // 回充（回桩）任务过程推送：WS `cmd: RECHARGE`，驱动 App 回充槽按钮（docs §12 / §13）。
  const onRechargeStatus = (payload: RechargeStatusPush) => {
    outbound.broadcastJson(buildRecharge(payload));
  };
  robot.on('rechargeStatus', onRechargeStatus);

  const mapTimer = setInterval(() => {
    if (!robot.shouldStreamMap()) return;
    outbound.broadcastRawMany(mapStream.nextFrame({ sn: robot.sn }));
  }, pushIntervalMs);

  let locationTickLogAt = 0;
  const locationTimer = setInterval(() => {
    const task = robot.activeTask();
    const recharge = robot.activeRechargeTask();
    const mowActive = !!task && task.status === 'ON_THE_WAY';
    // 回桩中（RECHARGE ON_THE_WAY）继续推送 ROBOT_LOCATION，使返回轨迹持续显示（docs §13）。
    const rechargeActive = !!recharge && recharge.status === 'ON_THE_WAY';
    if (!mowActive && !rechargeActive) {
      lastMowingLocationStatus = task ? task.status : null;
      return;
    }
    if (lastMowingLocationStatus !== 'ON_THE_WAY') {
      resetPoseState(pose);
    }
    lastMowingLocationStatus = 'ON_THE_WAY';
    const locationSn = task?.sn ?? recharge?.sn ?? robot.sn;
    const mapId = task ? taskMapId(task) : 'mock_map_001';
    const current = advancePose(pose);
    // 诊断：每秒最多一条，确认正在推流以及订阅者数量。
    const now = Date.now();
    if (now - locationTickLogAt > 1000) {
      locationTickLogAt = now;
      logger.info('ROBOT_LOCATION broadcast', {
        taskSn: locationSn,
        subscriberCount: outbound.locationSubscriberCount(locationSn),
        x: current.x,
        y: current.y,
      });
    }
    outbound.broadcastLocation(locationSn, buildRobotLocation(locationSn, current, { mapId }));
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
      robot.off('rechargeStatus', onRechargeStatus);
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
