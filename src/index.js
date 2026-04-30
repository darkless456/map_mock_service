// index.js — Map Mock Service (WebSocket protocol v2)
//
// Routes:
//   POST /ratel/api/v1/wss/acc_ticket  — issue short-lived WS ticket
//   GET  /api/health                   — health check
//   WS   /acc?ticket=<ticket>          — map stream connection
//
// Old routes (/api/auth/ws-signature, /ws/map) are intentionally removed.
const http = require('http');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const { loadAllPatches } = require('./data-loader');
const { encodeMapMessage } = require('./protocol');
const { verifyJwt, generateTicket, verifyTicket } = require('./auth');

/** Test data directory: change 'data' / 'data2' and restart to switch. */
const MOCK_DATA_DIR = process.env.MOCK_DATA_DIR || 'data2';
const MOCK_ROBOT_SN = process.env.ROBOT_SN || 'MOCK:00:11:22:33:44';

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

// ── HTTP server ──────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, platform');

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
    res.end(JSON.stringify({ status: 'ok', dataDir: MOCK_DATA_DIR, patchCount: patches.length }));
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

  // Send initial full map immediately on connect
  sendFullMap(ws);

  const pushTimer = setInterval(() => {
    if (!running || ws.readyState !== ws.OPEN) {
      clearInterval(pushTimer);
      return;
    }

    const patch = patches[patchIndex % patches.length];
    patchIndex++;
    globalFrameId++;

    const sec = Math.floor(patch.timestampMs / 1000);
    const nsec = Math.round((patch.timestampMs % 1000) * 1e6);

    const headerFields = {
      version:      1,
      msgType:      0x01,
      timestampSec: sec >>> 0,
      timestampNsec:nsec >>> 0,
      width:        patch.mapCols,
      height:       patch.mapRows,
      originX:      patch.originX,
      originY:      patch.originY,
      resolution:   patch.resolution,
      robotX:       0,
      robotY:       0,
      robotTheta:   0,
      frameId:      globalFrameId,
    };

    try {
      const message = encodeMapMessage({
        sn:           MOCK_ROBOT_SN,
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

      // ACK for received frames — used for flow control (no action needed in mock)
      if (msg.cmd === 'MAP_INCREMENTAL' && msg.data?.result === 'SUCCESS') {
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

      // Pass-through cmds from whitelist — pause/resume streaming
      if (msg.cmd === 'PAUSE') {
        running = false;
        console.log('Client requested PAUSE');
        return;
      }
      if (msg.cmd === 'RESUME') {
        running = true;
        console.log('Client requested RESUME');
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
    version:      1,
    msgType:      0x01,
    timestampSec: sec >>> 0,
    timestampNsec:nsec >>> 0,
    width:        patch.mapCols,
    height:       patch.mapRows,
    originX:      patch.originX,
    originY:      patch.originY,
    resolution:   patch.resolution,
    robotX:       0,
    robotY:       0,
    robotTheta:   0,
    frameId:      globalFrameId,
  };

  try {
    const message = encodeMapMessage({
      sn:          MOCK_ROBOT_SN,
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

// ── Start ────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Map Mock Service (v2 protocol) running on http://localhost:${PORT}`);
  console.log(`  Mock data dir: ${MOCK_DATA_DIR}/`);
  console.log(`  Robot SN:      ${MOCK_ROBOT_SN}`);
  console.log(`  Auth endpoint: POST /ratel/api/v1/wss/acc_ticket`);
  console.log(`  Health check:  GET  /api/health`);
  console.log(`  WebSocket:     ws://localhost:${PORT}/acc?ticket=<ticket>`);
  console.log(`  Push interval: ${PUSH_INTERVAL_MS}ms`);
});
