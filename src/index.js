// index.js — Map Mock Service (WebSocket protocol v2)
//
// Routes:
//   POST /ratel/api/v1/wss/acc_ticket                                    — issue short-lived WS ticket
//   GET  /api/health                                                      — health check
//   POST /api/robot/set_sn                                                — change mock robot SN at runtime
//   POST /api/robot/start_charging                                        — set work_status = charging
//   POST /api/robot/start_mapping                                         — set work_status = mapping
//   POST /api/robot/stop_mapping                                          — set work_status = idle
//   POST /api/robot/error                                                 — set work_status = error
//   GET  /api/map-config                                                  — base-map metadata
//   GET  /api/map-asset                                                   — serve full_semanticmap.png
//   GET  /api/annotations/:mapId                                          — semantic annotation package
//   WS   /acc?ticket=<ticket>                                             — map stream + mowing status
//
// Mowing task REST (mirrors real ratel gateway paths):
//   POST /ratel/central-control-service/api/v1/ratel_task/create         — create mowing task
//   POST /ratel/central-control-service/api/v1/ratel_task/action         — pause / resume / cancel
//   POST /ratel/central-control-service/api/v1/ratel_task/list           — task list for a SN
//
// Mowing WS protocol (server → client):
//   NOTIFY_MOW_STATUS  { cmd, cmd_id, data: { payload: { task_id, task_status, …TaskNotify }, sn } }
//   ROBOT_LOCATION     { cmd, data: { sn, mac, map_id, x, y, angle, timestamp, notify_time } }
//
// Mowing WS protocol (client → server):
//   LOCATION_REGISTER   { cmd, data: { sn } }
//   LOCATION_UNREGISTER { cmd, data: { sn } }
//
// Old routes (/api/auth/ws-signature, /ws/map, /api/robot/start_mowing,
//   /api/robot/stop_mowing, /api/robot/mowing_status) and legacy WS cmds
//   (MOWING_PAUSE, MOWING_RESUME, MOWING_STOP, ROBOT_POSE, MOWING_STATUS,
//   MOWING_START, MOWING_STOP) are intentionally removed.
const http = require('http');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { loadAllPatches } = require('./data-loader');
const { encodeMapMessage, encodeMapMessageSliced, isClientFrameAck } = require('./protocol');
const { verifyJwt, generateTicket, verifyTicket } = require('./auth');
const { getAnnotationPackage } = require('./annotation-store');
const fs = require('fs');
const path = require('path');

const SEMANTIC_MAP_PATH = path.resolve(__dirname, '..', 'full_semanticmap.png');

/** Test data directory: change 'data' / 'data2' / 'data3' and restart to switch. */
const MOCK_DATA_DIR = process.env.MOCK_DATA_DIR || 'data3';

/**
 * Robot SN used in every outbound WS message's `data.sn` field.
 *
 * Initial value comes from env `ROBOT_SN`; can be changed at runtime via
 * `POST /api/robot/set_sn` (see README for usage). Multiple mock instances
 * with different SNs can be run side-by-side on different ports to simulate
 * multi-robot scenarios for the new Rust-side SN filter (mapConfig.sn).
 *
 * Mutable via API — declared as `let` rather than `const` so robot-status
 * and frame builders read the latest value on every push.
 */
let mockRobotSn = process.env.ROBOT_SN || 'MOCK:00:11:22:33:44';

const PORT = parseInt(process.env.PORT, 10) || 9900;
const PUSH_INTERVAL_MS = parseInt(process.env.PUSH_INTERVAL_MS, 10) || 200;

console.log(`Loading map patches from ${MOCK_DATA_DIR}/ ...`);
const patches = loadAllPatches(MOCK_DATA_DIR);
console.log(`Loaded ${patches.length} map patches.`);

if (patches.length === 0) {
  console.error(`No patches found in ${MOCK_DATA_DIR}/. Exiting.`);
  process.exit(1);
}

let globalFrameId = 0;

// ── Robot work status ────────────────────────────────────────────────

let robotWorkStatus = 'idle';

// Controls whether incremental map frames are pushed to WS clients.
// Enabled by start_mapping, disabled by stop_mapping.
let mapStreamingActive = false;

// ── Mowing task store ────────────────────────────────────────────────
//
// `activeTasks`  — in-memory store of all known tasks, keyed by task_id.
// `tasksBySn`    — reverse index: sn → task_id (latest task per robot).
// `locationSubs` — per-WS-client set of SNs subscribed to ROBOT_LOCATION.
//
// Task shape:
//   { task_id, sn, status, task_info, mow_progress, mow_area, estimated_time,
//     task_type, task_message, task_error_code, created_at }

/** @type {Map<string, object>} */
const activeTasks = new Map();
/** @type {Map<string, string>} */
const tasksBySn   = new Map();
/** @type {WeakMap<import('ws').WebSocket, Set<string>>} */
const locationSubs = new WeakMap();

// ── Lawn / robot pose simulation ─────────────────────────────────────
//
// Coordinate system matches full_semanticmap.png:
//   512 × 512 px, 0.05 m/px → 25.6 m × 25.6 m world
//   Origin top-left, x right, y down
//   Lawn content bbox in world coords:
//     X ∈ [10.65, 14.20], Y ∈ [ 9.75, 14.75]
//   Robot follows an S-pattern, skipping a central flower-bed obstacle.

const MOW_FIELD_X1  = 10.80;
const MOW_FIELD_X2  = 14.00;   // width  3.20 m → ~8 S-lanes at 0.40 m
const MOW_FIELD_Y1  = 10.00;
const MOW_FIELD_Y2  = 14.60;   // height 4.60 m
const MOW_WIDTH_M   = 0.40;    // stripe / lane width
const ROBOT_STEP_M  = 0.10;    // distance per 300 ms tick ≈ 0.33 m/s

// Mock "flower bed" obstacle inside the lawn
const NO_GO_BOX = { minX: 12.00, maxX: 13.00, minY: 12.20, maxY: 13.20 };

/** Shared robot pose, updated by the pose-advance timer. */
let simX           = MOW_FIELD_X1;
let simY           = MOW_FIELD_Y1;
let simGoingRight  = true;

/** setInterval handle for the 300 ms ROBOT_LOCATION push. */
let robotLocTimer = null;
/** setInterval handle for the 5 s NOTIFY_MOW_STATUS push. */
let mowStatusTimer = null;

/** Advance the simulated robot by one step along the S-pattern path. */
function advanceRobotPos() {
  const dx = simGoingRight ? ROBOT_STEP_M : -ROBOT_STEP_M;
  simX += dx;

  // Simple obstacle skip
  if (
    simX >= NO_GO_BOX.minX && simX <= NO_GO_BOX.maxX &&
    simY >= NO_GO_BOX.minY && simY <= NO_GO_BOX.maxY
  ) {
    simX = simGoingRight ? NO_GO_BOX.maxX + ROBOT_STEP_M : NO_GO_BOX.minX - ROBOT_STEP_M;
  }

  if (simGoingRight && simX >= MOW_FIELD_X2) {
    simX = MOW_FIELD_X2;
    simY += MOW_WIDTH_M;
    simGoingRight = false;
  } else if (!simGoingRight && simX <= MOW_FIELD_X1) {
    simX = MOW_FIELD_X1;
    simY += MOW_WIDTH_M;
    simGoingRight = true;
  }

  if (simY > MOW_FIELD_Y2) {
    simX = MOW_FIELD_X1;
    simY = MOW_FIELD_Y1;
    simGoingRight = true;
  }
}

/** Returns true if any task is currently ON_THE_WAY. */
function isMowingActive() {
  for (const t of activeTasks.values()) {
    if (t.status === 'ON_THE_WAY') return true;
  }
  return false;
}

// ── Broadcast helpers ────────────────────────────────────────────────

/** Broadcast a JSON payload to all open WS clients. */
function broadcastJson(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  });
}

/**
 * Build a NOTIFY_MOW_STATUS message following the API doc format.
 *
 * Shape: { cmd, cmd_id, data: { payload: { …fields }, sn } }
 *
 * AUDIT NOTE: The app's `payloadOf` helper in useWsDeviceListener extracts
 * `root.data` (not `root.data.payload`).  As a result, `task_id` /
 * `task_status` inside `data.payload` will be invisible to `useMowingTask`
 * unless the app is patched to read `payload.payload.*` or the server flattens
 * `data.payload` into `data`.  See audit section below.
 */
function buildMowStatusMsg(task) {
  return {
    cmd:    'NOTIFY_MOW_STATUS',
    cmd_id: uuidv4(),
    data: {
      sn: task.sn,
      payload: {
        sn:               task.sn,
        task_id:          task.task_id,
        task_status:      task.status,
        task_type:        task.task_type,
        task_message:     task.task_message,
        task_error_code:  task.task_error_code,
        mow_area:         task.mow_area,
        mow_progress:     task.mow_progress,
        estimated_time:   task.estimated_time,
        timestamp:        Math.floor(Date.now() / 1000),
        notify_timestamp: Date.now(),
      },
    },
  };
}

/** Push NOTIFY_MOW_STATUS for a task to all connected WS clients. */
function pushMowStatus(task) {
  broadcastJson(buildMowStatusMsg(task));
}

/**
 * Build a ROBOT_LOCATION message following the API doc format.
 *
 * AUDIT NOTE: API doc uses `angle` (radians) but `RobotLocationEventPayload`
 * in the app declares `yaw`.  Mock follows the API doc (`angle`), so `yaw`
 * will be undefined in the app unless the field is renamed.
 */
function buildRobotLocationMsg(sn, x, y, angle) {
  const now = Date.now();
  return {
    cmd: 'ROBOT_LOCATION',
    data: {
      sn,
      mac:         'D2:9C:35:EF:D1:04',
      map_id:      '123',
      x,
      y,
      angle,
      timestamp:   Math.floor(now / 1000),
      notify_time: now,
    },
  };
}

/** Push ROBOT_LOCATION to each WS client that subscribed to `sn`. */
function pushRobotLocation(sn, x, y, angle) {
  const msg = JSON.stringify(buildRobotLocationMsg(sn, x, y, angle));
  wss.clients.forEach((ws) => {
    if (ws.readyState !== ws.OPEN) return;
    const subs = locationSubs.get(ws);
    if (subs && subs.has(sn)) ws.send(msg);
  });
}

// ── Mowing simulation timers ─────────────────────────────────────────

/** Start the 300 ms ROBOT_LOCATION push (runs while any task is ON_THE_WAY). */
function ensureRobotLocTimer() {
  if (robotLocTimer) return;
  robotLocTimer = setInterval(() => {
    if (!isMowingActive()) return;
    advanceRobotPos();
    const angle = simGoingRight ? 0 : Math.PI;
    pushRobotLocation(mockRobotSn, simX, simY, angle);
  }, 300);
}

/** Stop the ROBOT_LOCATION push timer. */
function stopRobotLocTimer() {
  if (robotLocTimer) { clearInterval(robotLocTimer); robotLocTimer = null; }
}

/** Start the 5 s periodic NOTIFY_MOW_STATUS push. */
function ensureMowStatusTimer() {
  if (mowStatusTimer) return;
  mowStatusTimer = setInterval(() => {
    for (const task of activeTasks.values()) {
      if (task.status !== 'ON_THE_WAY') continue;
      task.mow_progress = Math.min(100, task.mow_progress + 2);
      task.estimated_time = Math.max(0, Math.round((100 - task.mow_progress) * 3));
      if (task.mow_progress >= 100) {
        task.status = 'COMPLETE';
        task.task_message = 'Mowing complete';
        pushMowStatus(task);
        console.log(`[Mowing] Task ${task.task_id} auto-completed`);
        stopMowingSimIfIdle();
        return;
      }
      pushMowStatus(task);
    }
  }, 5000);
}

/** Stop the periodic NOTIFY_MOW_STATUS push. */
function stopMowStatusTimer() {
  if (mowStatusTimer) { clearInterval(mowStatusTimer); mowStatusTimer = null; }
}

/** Stop simulation timers when no active tasks remain. */
function stopMowingSimIfIdle() {
  if (!isMowingActive()) { stopRobotLocTimer(); stopMowStatusTimer(); }
}

// ── Mowing task lifecycle ────────────────────────────────────────────

/** Create a new task and start simulation. Returns the task object. */
function createTask(sn, taskInfo) {
  const task_id = `mock-task-${Date.now()}`;
  const task = {
    task_id,
    sn,
    status:          'ON_THE_WAY',
    task_type:       'cloud',
    task_message:    '',
    task_error_code: 0,
    mow_area:        256.5,
    mow_progress:    0,
    estimated_time:  300,
    task_info:       taskInfo,
    created_at:      Date.now(),
  };

  activeTasks.set(task_id, task);
  tasksBySn.set(sn, task_id);

  // Reset robot pose for new task
  simX = MOW_FIELD_X1;
  simY = MOW_FIELD_Y1;
  simGoingRight = true;

  console.log(`[Mowing] Task created: ${task_id} for SN=${sn}`);

  ensureRobotLocTimer();
  ensureMowStatusTimer();
  pushMowStatus(task);

  return task;
}

/** Apply an action (PAUSE / RESUME / CANCEL) to a task. Returns error string or null. */
function applyAction(task_id, action) {
  const task = activeTasks.get(task_id);
  if (!task) return `task ${task_id} not found`;

  switch (action) {
    case 'PAUSE':
      if (task.status !== 'ON_THE_WAY') return `cannot PAUSE from status ${task.status}`;
      task.status = 'PAUSE';
      task.task_message = 'Paused by user';
      break;
    case 'RESUME':
      if (task.status !== 'PAUSE') return `cannot RESUME from status ${task.status}`;
      task.status = 'ON_THE_WAY';
      task.task_message = '';
      ensureRobotLocTimer();
      ensureMowStatusTimer();
      break;
    case 'CANCEL':
      task.status = 'CANCEL';
      task.task_message = 'Cancelled by user';
      break;
    default:
      return `unknown action ${action}`;
  }

  console.log(`[Mowing] Task ${task_id} \u2192 ${task.status}`);
  pushMowStatus(task);
  stopMowingSimIfIdle();
  return null;
}

// ── HTTP helpers ──────────────────────────────────────────────────────

/** Read full request body as JSON, then call cb(parsed). */
function withJsonBody(req, res, cb) {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk.toString(); });
  req.on('end', () => {
    let parsed;
    try { parsed = raw ? JSON.parse(raw) : {}; }
    catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 400, message: 'Invalid JSON body' }));
      return;
    }
    cb(parsed);
  });
}

function buildRobotStatusMessage() {
  return JSON.stringify({
    cmd: 'ROBOT_STATUS',
    cmd_id: uuidv4(),
    sn: mockRobotSn,
    work_status: robotWorkStatus,
    battery: {
      level: 80,
      charging: robotWorkStatus === 'charging' ? 1 : -1,
      temperature: 30,
      cycles: 42,
    },
    signals: {
      bluetooth: { connected: 1, rssi: -55 },
      wifi: { connected: 1, ssid: 'MockWiFi', rssi: -60, signal_strength: 'good' },
      cellular: { connected: 0, signal_strength: 'weak' },
    },
  });
}

function broadcastRobotStatus() {
  const msg = buildRobotStatusMessage();
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  });
}

// ── HTTP server ──────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, platform, X-Device, X-Device-Id, X-Device-Version');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── POST /ratel/api/v1/wss/acc_ticket ─────────────────────────────
  if (url.pathname === '/ratel/api/v1/wss/acc_ticket' && req.method === 'POST') {
    const platform = req.headers['platform'];
    if (!platform) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 400, message: 'platform is required', ticket: '', expire_seconds: 0, wss_path_hint: '' }));
      return;
    }

    const authResult = verifyJwt(req.headers.authorization);
    if (!authResult.valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 401, message: authResult.error, ticket: '', expire_seconds: 0, wss_path_hint: '' }));
      return;
    }

    const { ticket, expire_seconds } = generateTicket(authResult.payload);
    const wssHint = `ws://localhost:${PORT}/acc?ticket=${ticket}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 200, message: 'Success', ticket, expire_seconds, wss_path_hint: wssHint }));
    return;
  }

  // ── GET /api/health ───────────────────────────────────────────────
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status:      'ok',
      dataDir:     MOCK_DATA_DIR,
      patchCount:  patches.length,
      work_status: robotWorkStatus,
      sn:          mockRobotSn,
      activeTasks: activeTasks.size,
    }));
    return;
  }

  // ── POST /api/robot/set_sn ────────────────────────────────────────
  if (url.pathname === '/api/robot/set_sn' && req.method === 'POST') {
    withJsonBody(req, res, (parsed) => {
      const newSn = typeof parsed.sn === 'string' ? parsed.sn.trim() : '';
      if (!newSn) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 400, message: 'sn is required (non-empty string)' }));
        return;
      }
      const prevSn = mockRobotSn;
      mockRobotSn = newSn;
      console.log(`Robot SN changed: ${prevSn} -> ${mockRobotSn}`);
      broadcastRobotStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 200, message: 'Success', sn: mockRobotSn, previousSn: prevSn }));
    });
    return;
  }

  // ── POST /api/robot/:action ───────────────────────────────────────
  // Retained: charging / mapping / error status helpers (mowing lifecycle
  // is now driven by the ratel_task REST endpoints below).
  const robotActionMap = {
    '/api/robot/start_charging': 'charging',
    '/api/robot/start_mapping':  'mapping',
    '/api/robot/stop_mapping':   'idle',
    '/api/robot/error':          'error',
  };

  if (req.method === 'POST' && robotActionMap[url.pathname] !== undefined) {
    robotWorkStatus = robotActionMap[url.pathname];

    if (url.pathname === '/api/robot/start_mapping') {
      mapStreamingActive = true;
      console.log('Map streaming STARTED');
    } else if (url.pathname === '/api/robot/stop_mapping') {
      mapStreamingActive = false;
      console.log('Map streaming STOPPED');
    }

    console.log(`Robot work_status changed to: ${robotWorkStatus}`);
    broadcastRobotStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 200, message: 'Success', work_status: robotWorkStatus }));
    return;
  }

  // ── POST /ratel/central-control-service/api/v1/ratel_task/create ──
  //
  // Body: { sn, task_info: { task_mode, map_id, area_id?, mow_height,
  //                          mow_speed, texture: { mode, bow_shaped_spacing,
  //                          texture_angle, intelligent_alternation_mode } } }
  // Response: { code: 200, data: { task_id, robot_code, robot_message } }
  if (
    url.pathname === '/ratel/central-control-service/api/v1/ratel_task/create' &&
    req.method === 'POST'
  ) {
    withJsonBody(req, res, (body) => {
      const sn = typeof body.sn === 'string' ? body.sn.trim() : '';
      if (!sn) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 400, message: 'sn is required' }));
        return;
      }
      if (!body.task_info || typeof body.task_info !== 'object') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 400, message: 'task_info is required' }));
        return;
      }
      const task = createTask(sn, body.task_info);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: 200,
        message: '',
        data: { task_id: task.task_id, robot_code: 0, robot_message: 'ok' },
      }));
    });
    return;
  }

  // ── POST /ratel/central-control-service/api/v1/ratel_task/action ──
  //
  // Body: { sn, task_id, action: "PAUSE" | "RESUME" | "CANCEL" }
  // Response: { code: 200, data: { robot_code, robot_message } }
  if (
    url.pathname === '/ratel/central-control-service/api/v1/ratel_task/action' &&
    req.method === 'POST'
  ) {
    withJsonBody(req, res, (body) => {
      const { task_id, action } = body;
      if (!task_id || !action) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 400, message: 'task_id and action are required' }));
        return;
      }
      const err = applyAction(task_id, action);
      if (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 400, message: err, data: { robot_code: -1, robot_message: err } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 200, message: '', data: { robot_code: 0, robot_message: 'ok' } }));
    });
    return;
  }

  // ── POST /ratel/central-control-service/api/v1/ratel_task/list ────
  //
  // Body: { sn }
  // Response: { code: 200, data: { total, list, task_info?, task_notify? } }
  if (
    url.pathname === '/ratel/central-control-service/api/v1/ratel_task/list' &&
    req.method === 'POST'
  ) {
    withJsonBody(req, res, (body) => {
      const sn = typeof body.sn === 'string' ? body.sn.trim() : '';

      // Collect tasks for this SN (all states), newest first
      const list = [];
      for (const t of activeTasks.values()) {
        if (!sn || t.sn === sn) list.push({ task_id: t.task_id, task_status: t.status });
      }
      list.sort((a, b) => {
        const ta = activeTasks.get(a.task_id);
        const tb = activeTasks.get(b.task_id);
        return (tb ? tb.created_at : 0) - (ta ? ta.created_at : 0);
      });

      const currentTaskId = tasksBySn.get(sn);
      const currentTask   = currentTaskId ? activeTasks.get(currentTaskId) : null;
      const isActive      = currentTask &&
        (currentTask.status === 'ON_THE_WAY' || currentTask.status === 'PAUSE');

      const data = {
        total:       list.length,
        list,
        task_info:   isActive ? currentTask.task_info : null,
        task_notify: isActive
          ? {
              task_type:       currentTask.task_type,
              task_message:    currentTask.task_message,
              task_error_code: currentTask.task_error_code,
              mow_area:        currentTask.mow_area,
              mow_progress:    currentTask.mow_progress,
              estimated_time:  currentTask.estimated_time,
            }
          : null,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 200, message: '', data }));
    });
    return;
  }

  // ── GET /api/map-config ───────────────────────────────────────────
  //
  // Returns: { map_id, base_version, resolution, asset_uri }
  // The `asset_uri` points to GET /api/map-asset?map_id=<id> on this service.
  if (url.pathname === '/api/map-config' && req.method === 'GET') {
    const mapId = url.searchParams.get('map_id') || 'mock_map_001';
    // Use the Host header so the returned URI is reachable from the requesting client
    // (devices/emulators cannot reach `localhost` on the host machine).
    const host = req.headers.host || `localhost:${PORT}`;
    const assetUri = `http://${host}/api/map-asset?map_id=${encodeURIComponent(mapId)}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      map_id: mapId,
      base_version: 1,
      resolution: 0.05,
      asset_uri: assetUri,
    }));
    return;
  }

  // ── GET /api/map-asset ────────────────────────────────────────────
  //
  // Serves full_semanticmap.png as the base-map image.
  if (url.pathname === '/api/map-asset' && req.method === 'GET') {
    let imageData;
    try {
      imageData = fs.readFileSync(SEMANTIC_MAP_PATH);
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'full_semanticmap.png not found' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': imageData.length,
      'Cache-Control': 'no-store',
    });
    res.end(imageData);
    return;
  }

  // ── GET /api/annotations/:mapId ───────────────────────────────────
  //
  // Returns an IncrementPackage (JSON) for the requested map_id.
  const annotationsMatch = url.pathname.match(/^\/api\/annotations\/([^/]+)$/);
  if (annotationsMatch && req.method === 'GET') {
    const mapId = decodeURIComponent(annotationsMatch[1]);
    const pkg = getAnnotationPackage(mapId);
    if (!pkg) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No annotations found for map_id: ${mapId}` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pkg));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// ── WebSocket server ──────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname !== '/acc') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const ticketParam = url.searchParams.get('ticket');
  if (!verifyTicket(ticketParam).valid) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  console.log(`WS client connected from ${req.socket.remoteAddress}`);

  // Initialise per-client location subscription set
  locationSubs.set(ws, new Set());

  let patchIndex = 0;
  let running    = true;

  // Send initial full map and current robot status immediately on connect
  sendFullMap(ws);
  ws.send(buildRobotStatusMessage());

  // Push any currently active/paused task status so the app can reconcile
  for (const task of activeTasks.values()) {
    if (task.status === 'ON_THE_WAY' || task.status === 'PAUSE') {
      ws.send(JSON.stringify(buildMowStatusMsg(task)));
    }
  }

  const pushTimer = setInterval(() => {
    if (!running || ws.readyState !== ws.OPEN) {
      clearInterval(pushTimer);
      return;
    }

    // Only push incremental frames while mapping is active
    if (!mapStreamingActive) return;

    const patch = patches[patchIndex % patches.length];
    patchIndex++;
    globalFrameId++;

    const sec = Math.floor(patch.timestampMs / 1000);
    const nsec = Math.round((patch.timestampMs % 1000) * 1e6);

    const headerFields = {
      msgType:      2,
      timestampSec: sec >>> 0,
      timestampNsec:nsec >>> 0,
      width:        patch.mapCols,
      height:       patch.mapRows,
      originX:      patch.originX,
      originY:      patch.originY,
      resolution:   patch.resolution,
      robotX:       patch.robotX,
      robotY:       patch.robotY,
      robotTheta:   patch.robotTheta,
      frameId:      globalFrameId,
    };

    try {
      const messages = encodeMapMessageSliced({
        sn:           mockRobotSn,
        headerFields,
        imageBytes:   patch.imageData,
        cmd:          'MAP_INCREMENTAL',
      });

      if (ws.readyState === ws.OPEN) {
        for (const message of messages) {
          ws.send(message);
        }
      }
    } catch (err) {
      console.error(`Failed to encode patch ${patch.id}:`, err.message);
    }
  }, PUSH_INTERVAL_MS);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

// ACK for received frames — Rust sends { data: { code: 200, msg: "success", frame_id?, ... } }
      // Reply with server acknowledgment so Rust client skips it cleanly.
      if (isClientFrameAck(msg)) {
        ws.send(JSON.stringify({
          cmd:    msg.cmd,
          cmd_id: msg.cmd_id,
          data:   { code: 200 },
        }));
        return;
      }

      // JSON heartbeat cmd (auth keepalive): reply with {code,codeMsg,data} structure
      if (msg.cmd === 'heartbeat') {
        ws.send(JSON.stringify({
          cmd:    'heartbeat',
          cmd_id: msg.cmd_id,
          data:   { code: 200, codeMsg: 'Success', data: {} },
        }));
        return;
      }

      // JSON ping cmd (connectivity check): reply with data.data = "pong"
      if (msg.cmd === 'ping') {
        ws.send(JSON.stringify({
          cmd:    'ping',
          cmd_id: msg.cmd_id,
          data:   { code: 200, codeMsg: 'Success', data: 'pong' },
        }));
        return;
      }

      // MAP_INCREMENTAL_REISSUE: client dropped a sliced frame and requests re-delivery.
      // Mock responds by resending the current full map as a MAP_FIX frame.
      if (msg.cmd === 'MAP_INCREMENTAL_REISSUE') {
        const frameId = msg.data?.frame_id ?? msg.data?.frameId;
        console.log(`Client requested reissue for frame_id=${frameId}`);
        sendFullMap(ws);
        return;
      }

      // ── LOCATION_REGISTER ─────────────────────────────────────────
      // Client → Server: { cmd: "LOCATION_REGISTER", data: { sn } }
      // Server starts pushing ROBOT_LOCATION for that SN to this client.
      if (msg.cmd === 'LOCATION_REGISTER') {
        const targetSn = msg.data?.sn;
        if (typeof targetSn === 'string' && targetSn) {
          const subs = locationSubs.get(ws);
          if (subs) {
            subs.add(targetSn);
            console.log(`[WS] LOCATION_REGISTER sn=${targetSn}`);
          }
        }
        return;
      }

      // ── LOCATION_UNREGISTER ───────────────────────────────────────
      // Client → Server: { cmd: "LOCATION_UNREGISTER", data: { sn } }
      // Server stops pushing ROBOT_LOCATION for that SN to this client.
      if (msg.cmd === 'LOCATION_UNREGISTER') {
        const targetSn = msg.data?.sn;
        if (typeof targetSn === 'string' && targetSn) {
          const subs = locationSubs.get(ws);
          if (subs) {
            subs.delete(targetSn);
            console.log(`[WS] LOCATION_UNREGISTER sn=${targetSn}`);
          }
        }
        return;
      }
    } catch {
      // Silently ignore malformed messages
    }
  });

  ws.on('close', () => {
    running = false;
    clearInterval(pushTimer);
    locationSubs.delete(ws);
    console.log('WS client disconnected');
  });

  ws.on('error', (err) => {
    running = false;
    clearInterval(pushTimer);
    console.error('WS error:', err.message);
  });
});

function sendFullMap(ws) {
  if (ws.readyState !== ws.OPEN || patches.length === 0) return;

  const patch = patches[0];
  globalFrameId++;

  const sec = Math.floor(patch.timestampMs / 1000);
  const nsec = Math.round((patch.timestampMs % 1000) * 1e6);

  const headerFields = {
    msgType:      2,
    timestampSec: sec >>> 0,
    timestampNsec:nsec >>> 0,
    width:        patch.mapCols,
    height:       patch.mapRows,
    originX:      patch.originX,
    originY:      patch.originY,
    resolution:   patch.resolution,
    robotX:       patch.robotX,
    robotY:       patch.robotY,
    robotTheta:   patch.robotTheta,
    frameId:      globalFrameId,
  };

  try {
    const messages = encodeMapMessageSliced({
      sn:          mockRobotSn,
      headerFields,
      imageBytes:  patch.imageData,
      cmd:         'MAP_FIX',
    });
    if (ws.readyState === ws.OPEN) {
      for (const message of messages) {
        ws.send(message);
      }
    }
  } catch (err) {
    console.error('Failed to send full map:', err.message);
  }
}

// ── Start ────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Map Mock Service (v2 protocol) running on http://0.0.0.0:${PORT}`);
  console.log(`  Mock data dir:       ${MOCK_DATA_DIR}/`);
  console.log(`  Robot SN:            ${mockRobotSn}`);
  console.log(`  Auth endpoint:       POST /ratel/api/v1/wss/acc_ticket`);
  console.log(`  Health check:        GET  /api/health`);
  console.log(`  WebSocket:           ws://localhost:${PORT}/acc?ticket=<ticket>`);
  console.log(`  Push interval:       ${PUSH_INTERVAL_MS}ms`);
  console.log(`  Mowing task create:  POST /ratel/central-control-service/api/v1/ratel_task/create`);
  console.log(`  Mowing task action:  POST /ratel/central-control-service/api/v1/ratel_task/action`);
  console.log(`  Mowing task list:    POST /ratel/central-control-service/api/v1/ratel_task/list`);
});
