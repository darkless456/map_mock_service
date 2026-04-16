const http = require('http');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const { loadAllPatches } = require('./data-loader');
const { encodeMapMessage } = require('./protocol');
const { verifyToken, generateWsSignature, verifyWsSignature } = require('./auth');

const PORT = parseInt(process.env.PORT, 10) || 9900;
const PUSH_INTERVAL_MS = parseInt(process.env.PUSH_INTERVAL_MS, 10) || 200;

console.log('Loading map patches from data directory...');
const patches = loadAllPatches();
console.log(`Loaded ${patches.length} map patches.`);

if (patches.length === 0) {
  console.error('No patches found in data directory. Exiting.');
  process.exit(1);
}

let globalSessionId = 0;

// ── HTTP server ──────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/api/auth/ws-signature' && req.method === 'GET') {
    const authResult = verifyToken(req.headers.authorization);
    if (!authResult.valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: authResult.error }));
      return;
    }

    const wsSign = generateWsSignature(authResult.payload);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        wsUrl: `ws://localhost:${PORT}/ws/map`,
        signature: wsSign.signature,
        expiresAt: wsSign.expiresAt,
      })
    );
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', patchCount: patches.length }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// ── WebSocket server ──────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname !== '/ws/map') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const signature = url.searchParams.get('signature');
  const authResult = verifyWsSignature(signature);
  if (!authResult.valid) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  console.log(`WS client connected from ${req.socket.remoteAddress}`);

  let patchIndex = 0;
  let running = true;

  const pushTimer = setInterval(() => {
    if (!running || ws.readyState !== ws.OPEN) {
      clearInterval(pushTimer);
      return;
    }

    const patch = patches[patchIndex % patches.length];
    patchIndex++;

    globalSessionId++;
    const sesstionId = globalSessionId;

    const totalMs = patch.timestampMs;
    const sec = Math.floor(totalMs / 1000);
    const nsec = Math.round((totalMs % 1000) * 1e6);

    const headerFields = {
      version: 1,
      msgType: 0x01,
      sesstionId,
      timestampSec: sec >>> 0,
      timestampNsec: nsec >>> 0,
      width: patch.mapCols,
      height: patch.mapRows,
      originX: patch.originX,
      originY: patch.originY,
      resolution: patch.resolution,
      robotX: 0,
      robotY: 0,
      robotTheta: 0,
      needAck: 1,
    };

    try {
      const message = encodeMapMessage(
        headerFields,
        patch.imageData,
        'MAP_INCREMENTAL_PATCH'
      );

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
      switch (msg.cmd) {
        case 'PAUSE':
          running = false;
          console.log('Client requested pause');
          break;
        case 'RESUME':
          running = true;
          console.log('Client requested resume');
          break;
        case 'REQUEST_FULL_MAP':
          sendFullMap(ws, 'MAP_FIX_PATCH');
          break;
        case 'MAP_ACK':
          break;
        default:
          break;
      }
    } catch {
      // ignore malformed messages
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

  sendFullMap(ws, 'MAP_FIX_PATCH');
});

function sendFullMap(ws, cmd = 'MAP_FIX_PATCH') {
  if (ws.readyState !== ws.OPEN || patches.length === 0) return;

  const patch = patches[0];
  globalSessionId++;

  const totalMs = patch.timestampMs;
  const sec = Math.floor(totalMs / 1000);
  const nsec = Math.round((totalMs % 1000) * 1e6);

  const headerFields = {
    version: 1,
    msgType: 0x01,
    sesstionId: globalSessionId,
    timestampSec: sec >>> 0,
    timestampNsec: nsec >>> 0,
    width: patch.mapCols,
    height: patch.mapRows,
    originX: patch.originX,
    originY: patch.originY,
    resolution: patch.resolution,
    robotX: 0,
    robotY: 0,
    robotTheta: 0,
    needAck: 1,
  };

  const message = encodeMapMessage(headerFields, patch.imageData, cmd);
  if (ws.readyState === ws.OPEN) {
    ws.send(message);
  }
}

// ── Heartbeat ────────────────────────────────────────────────────────

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// ── Start ────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Map Mock Service running on http://localhost:${PORT}`);
  console.log(`  Auth endpoint: GET /api/auth/ws-signature`);
  console.log(`  Health check:  GET /api/health`);
  console.log(`  WebSocket:     ws://localhost:${PORT}/ws/map?signature=<sig>`);
  console.log(`  Push interval: ${PUSH_INTERVAL_MS}ms`);
});
