// index.js — Map Mock Service (WebSocket protocol v2)
//
// Routes:
//   POST /ratel/api/v1/wss/acc_ticket  — issue short-lived WS ticket
//   GET  /api/health                   — health check
//   POST /api/robot/start_mowing       — set work_status = mowing
//   POST /api/robot/start_charging     — set work_status = charging
//   POST /api/robot/start_mapping      — set work_status = mapping
//   POST /api/robot/stop_mowing        — set work_status = idle
//   POST /api/robot/stop_mapping       — set work_status = idle
//   POST /api/robot/error              — set work_status = error
//   WS   /acc?ticket=<ticket>          — map stream connection
//
// Old routes (/api/auth/ws-signature, /ws/map) are intentionally removed.
const http = require('http');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { loadAllPatches } = require('./data-loader');
const { encodeMapMessage, isClientFrameAck } = require('./protocol');
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

// ── Mowing simulation state ───────────────────────────────────────────

/**
 * Whether a mowing task is currently active.
 * Set true by POST /api/robot/start_mowing, false by stop_mowing.
 */
let mowingActive = false;
let mowingTaskId = null;
let robotPoseTimer = null;   // setInterval handle for ROBOT_POSE push
let mowingStatusTimer = null; // setInterval handle for MOWING_STATUS push

// Robot path state (S-pattern across a 8m × 8m mowing field)
const MOW_FIELD_X1 = 1.5;
const MOW_FIELD_X2 = 8.5;
const MOW_FIELD_Y1 = 1.5;
const MOW_FIELD_Y2 = 8.5;
const MOW_STRIPE_Y = 0.5;   // row spacing (= mow_width_m)
const ROBOT_STEP_M = 0.10;  // meters per pose push (300 ms interval → ~0.33 m/s)

let mowRobotX = MOW_FIELD_X1;
let mowRobotY = MOW_FIELD_Y1;
let mowGoingRight = true;
let mowingPaused = false;   // true while MOWING_PAUSE is active

const MOCK_PLAN_ZONES = [
  {
    id: 'zone_main',
    polygon: [
      [MOW_FIELD_X1, MOW_FIELD_Y1],
      [MOW_FIELD_X2, MOW_FIELD_Y1],
      [MOW_FIELD_X2, MOW_FIELD_Y2],
      [MOW_FIELD_X1, MOW_FIELD_Y2],
    ],
    label: '主草坪',
  },
];

const MOCK_NO_GO_ZONES = [
  {
    id: 'nogo_obstacle',
    polygon: [
      [3.5, 3.5],
      [5.5, 3.5],
      [5.5, 5.5],
      [3.5, 5.5],
    ],
    label: '花坛',
  },
];

/** Advance robot position by one step along the S-pattern path. */
function advanceMowingPosition() {
  const dx = mowGoingRight ? ROBOT_STEP_M : -ROBOT_STEP_M;
  mowRobotX += dx;

  if (mowGoingRight && mowRobotX >= MOW_FIELD_X2) {
    mowRobotX = MOW_FIELD_X2;
    mowRobotY += MOW_STRIPE_Y;
    mowGoingRight = false;
  } else if (!mowGoingRight && mowRobotX <= MOW_FIELD_X1) {
    mowRobotX = MOW_FIELD_X1;
    mowRobotY += MOW_STRIPE_Y;
    mowGoingRight = true;
  }

  // Wrap around when the whole field is covered
  if (mowRobotY > MOW_FIELD_Y2) {
    mowRobotX = MOW_FIELD_X1;
    mowRobotY = MOW_FIELD_Y1;
    mowGoingRight = true;
  }
}

/** Broadcast a JSON payload to all open WS clients. */
function broadcastJson(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  });
}

/** Start the ROBOT_POSE push timer (300 ms interval). */
function startRobotPoseTimer() {
  if (robotPoseTimer) return;
  robotPoseTimer = setInterval(() => {
    if (!mowingActive || mowingPaused) return;
    advanceMowingPosition();
    const yaw = mowGoingRight ? 0 : Math.PI;
    broadcastJson({
      cmd: 'ROBOT_POSE',
      sn:  mockRobotSn,
      data: {
        x:             mowRobotX,
        y:             mowRobotY,
        yaw,
        timestamp_sec: Math.floor(Date.now() / 1000),
      },
    });
  }, 300);
}

/** Stop the ROBOT_POSE push timer. */
function stopRobotPoseTimer() {
  if (robotPoseTimer) {
    clearInterval(robotPoseTimer);
    robotPoseTimer = null;
  }
}

/** Start the periodic MOWING_STATUS push (every 5 s). */
function startMowingStatusTimer() {
  if (mowingStatusTimer) return;
  mowingStatusTimer = setInterval(() => {
    if (!mowingActive) return;
    broadcastJson({
      cmd:  'MOWING_STATUS',
      sn:   mockRobotSn,
      data: {
        state:         mowingPaused ? 'PAUSED' : 'MOWING',
        battery:       0.78,
        error_code:    null,
        timestamp_sec: Math.floor(Date.now() / 1000),
      },
    });
  }, 5000);
}

/** Stop the MOWING_STATUS push timer. */
function stopMowingStatusTimer() {
  if (mowingStatusTimer) {
    clearInterval(mowingStatusTimer);
    mowingStatusTimer = null;
  }
}

/** Start a new mowing task: broadcast MOWING_START + begin pose push. */
function startMowingTask() {
  mowingActive   = true;
  mowingPaused   = false;
  mowingTaskId   = `task_${Date.now()}`;
  mowRobotX      = MOW_FIELD_X1;
  mowRobotY      = MOW_FIELD_Y1;
  mowGoingRight  = true;

  console.log(`[Mowing] Task started: ${mowingTaskId}`);

  broadcastJson({
    cmd:  'MOWING_START',
    sn:   mockRobotSn,
    data: {
      task_id:      mowingTaskId,
      mow_width_m:  0.5,
      plan_zones:   MOCK_PLAN_ZONES,
      no_go_zones:  MOCK_NO_GO_ZONES,
      timestamp_sec: Math.floor(Date.now() / 1000),
    },
  });

  // Send initial MOWING_STATUS so client transitions to MOWING immediately
  broadcastJson({
    cmd:  'MOWING_STATUS',
    sn:   mockRobotSn,
    data: {
      state:         'MOWING',
      battery:       0.78,
      error_code:    null,
      timestamp_sec: Math.floor(Date.now() / 1000),
    },
  });

  startRobotPoseTimer();
  startMowingStatusTimer();
}

/** Stop the current mowing task: stop pose push + broadcast MOWING_STOP. */
function stopMowingTask() {
  mowingActive = false;
  mowingPaused = false;
  stopRobotPoseTimer();
  stopMowingStatusTimer();

  console.log(`[Mowing] Task stopped: ${mowingTaskId}`);

  broadcastJson({
    cmd:  'MOWING_STOP',
    sn:   mockRobotSn,
    data: {
      task_id:       mowingTaskId,
      reason:        'server_stopped',
      timestamp_sec: Math.floor(Date.now() / 1000),
    },
  });

  mowingTaskId = null;
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
      status: 'ok',
      dataDir: MOCK_DATA_DIR,
      patchCount: patches.length,
      work_status: robotWorkStatus,
      sn: mockRobotSn,
    }));
    return;
  }

  // ── POST /api/robot/set_sn ────────────────────────────────────────
  // Runtime SN switcher — useful to test the JS/Rust mapConfig.sn filter
  // without restarting the service. Body: { "sn": "<new-sn>" }
  if (url.pathname === '/api/robot/set_sn' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 400, message: 'Invalid JSON body' }));
        return;
      }
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
  const robotActionMap = {
    '/api/robot/start_mowing':  'mowing',
    '/api/robot/start_charging': 'charging',
    '/api/robot/start_mapping':  'mapping',
    '/api/robot/stop_mowing':    'idle',
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

    // Mowing lifecycle hooks
    if (url.pathname === '/api/robot/start_mowing') {
      startMowingTask();
    } else if (url.pathname === '/api/robot/stop_mowing') {
      if (mowingActive) stopMowingTask();
    }

    console.log(`Robot work_status changed to: ${robotWorkStatus}`);
    broadcastRobotStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 200, message: 'Success', work_status: robotWorkStatus }));
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

  let patchIndex = 0;
  let running = true;

  // Send initial full map and current robot status immediately on connect
  sendFullMap(ws);
  ws.send(buildRobotStatusMessage());

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
      const message = encodeMapMessage({
        sn:           mockRobotSn,
        headerFields,
        imageBytes:   patch.imageData,
        cmd:          'MAP_INCREMENTAL',
      });

      if (ws.readyState === ws.OPEN) {
        ws.send(message);
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

      // ── Mowing control cmds from the app ──────────────────────────────
      if (msg.cmd === 'MOWING_PAUSE') {
        if (mowingActive && !mowingPaused) {
          mowingPaused = true;
          console.log('[Mowing] Paused by client');
          ws.send(JSON.stringify({
            cmd:  'MOWING_STATUS',
            sn:   mockRobotSn,
            data: {
              state:         'PAUSED',
              battery:       0.78,
              error_code:    null,
              timestamp_sec: Math.floor(Date.now() / 1000),
            },
          }));
        }
        return;
      }

      if (msg.cmd === 'MOWING_RESUME') {
        if (mowingActive && mowingPaused) {
          mowingPaused = false;
          console.log('[Mowing] Resumed by client');
          ws.send(JSON.stringify({
            cmd:  'MOWING_STATUS',
            sn:   mockRobotSn,
            data: {
              state:         'MOWING',
              battery:       0.78,
              error_code:    null,
              timestamp_sec: Math.floor(Date.now() / 1000),
            },
          }));
        }
        return;
      }

      if (msg.cmd === 'MOWING_STOP') {
        if (mowingActive) {
          stopMowingTask();
          console.log('[Mowing] Stopped by client');
        }
        return;
      }
    } catch {
      // Silently ignore malformed messages
    }
  });

  ws.on('close', () => {
    clearInterval(pushTimer);
    console.log('WS client disconnected');
  });

  ws.on('error', (err) => {
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
    const message = encodeMapMessage({
      sn:          mockRobotSn,
      headerFields,
      imageBytes:  patch.imageData,
      cmd:         'MAP_FIX',
    });
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  } catch (err) {
    console.error('Failed to send full map:', err.message);
  }
}
  // ── GET /api/robot/mowing_status (debug) ──────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/robot/mowing_status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      active:     mowingActive,
      paused:     mowingPaused,
      task_id:    mowingTaskId,
      robot:      { x: mowRobotX, y: mowRobotY, going_right: mowGoingRight },
      plan_zones: MOCK_PLAN_ZONES,
      no_go_zones: MOCK_NO_GO_ZONES,
    }));
    return;
  }
// ── Start ────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Map Mock Service (v2 protocol) running on http://0.0.0.0:${PORT}`);
  console.log(`  Mock data dir: ${MOCK_DATA_DIR}/`);
  console.log(`  Robot SN:      ${mockRobotSn}`);
  console.log(`  Auth endpoint: POST /ratel/api/v1/wss/acc_ticket`);
  console.log(`  Health check:  GET  /api/health`);
  console.log(`  WebSocket:     ws://localhost:${PORT}/acc?ticket=<ticket>`);
  console.log(`  Push interval: ${PUSH_INTERVAL_MS}ms`);
});
