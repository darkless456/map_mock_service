'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const express = require('express');
const Aedes = require('aedes');
const ws = require('ws');
const { XMLParser } = require('fast-xml-parser');

// ─── Configuration ──────────────────────────────────────────────────────────
const CONFIG = {
  httpPort: 3000,
  mqttTcpPort: 1883,
  mqttWsPort: 8883,
  mqttTopic: 'robot/map/increment',
  dataDir: path.resolve(__dirname, '..', 'data'),
  publishIntervalMs: 100,  // 10 Hz
};

// ─── Data Loader ────────────────────────────────────────────────────────────
function loadDataPairs(dataDir) {
  const files = fs.readdirSync(dataDir);
  const xmlFiles = files
    .filter(f => f.endsWith('.xml'))
    .sort((a, b) => {
      const ta = BigInt(a.replace('.xml', ''));
      const tb = BigInt(b.replace('.xml', ''));
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

  const pairs = [];
  for (const xmlFile of xmlFiles) {
    const baseName = xmlFile.replace('.xml', '');
    const pngFile = baseName + '.png';
    const pngPath = path.join(dataDir, pngFile);
    const xmlPath = path.join(dataDir, xmlFile);
    if (fs.existsSync(pngPath)) {
      pairs.push({ baseName, pngPath, xmlPath });
    }
  }
  return pairs;
}

// ─── XML → JSON Converter ───────────────────────────────────────────────────
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
});

function parseXmlToJson(xmlPath) {
  const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
  const parsed = xmlParser.parse(xmlContent);
  const storage = parsed.opencv_storage;
  return {
    timestamp_ms: storage.timestamp_ms,
    resolution: storage.resolution,
    origin_x: storage.origin_x,
    origin_y: storage.origin_y,
    map_cols: storage.map_cols,
    map_rows: storage.map_rows,
  };
}

// ─── Binary Frame Builder ───────────────────────────────────────────────────
// Frame format:
//   [4 bytes: JSON length (uint32 BE)] + [JSON bytes (UTF-8)] + [PNG binary bytes]
//
// Client parsing pseudo-code:
//   jsonLen = buffer.readUInt32BE(0)
//   json    = buffer.slice(4, 4 + jsonLen)
//   png     = buffer.slice(4 + jsonLen)
function buildFrame(jsonObj, pngBuffer) {
  const jsonStr = JSON.stringify(jsonObj);
  const jsonBuf = Buffer.from(jsonStr, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(jsonBuf.length, 0);
  return Buffer.concat([header, jsonBuf, pngBuffer]);
}

// ─── MQTT Broker (Aedes) ───────────────────────────────────────────────────
const aedes = Aedes();

// TCP listener (native MQTT, port 1883)
const mqttTcpServer = net.createServer(aedes.handle);

// WebSocket listener (MQTT over WS, port 8883)
const wsHttpServer = http.createServer();
const wss = new ws.WebSocketServer({ server: wsHttpServer });
wss.on('connection', (socket, req) => {
  const duplex = ws.createWebSocketStream(socket);
  aedes.handle(duplex);
});

aedes.on('client', (client) => {
  console.log(`[MQTT] Client connected: ${client.id}`);
});
aedes.on('clientDisconnect', (client) => {
  console.log(`[MQTT] Client disconnected: ${client.id}`);
});

// ─── Streaming State Machine ────────────────────────────────────────────────
const State = { IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused' };

let streamState = State.IDLE;
let dataPairs = [];
let currentIndex = 0;
let publishTimer = null;
let totalPublished = 0;
let loopCount = 0;

function publishNext() {
  if (streamState !== State.RUNNING) return;
  if (dataPairs.length === 0) return;

  const pair = dataPairs[currentIndex];
  try {
    const metadata = parseXmlToJson(pair.xmlPath);
    metadata.seq = totalPublished;
    metadata.frame_index = currentIndex;
    metadata.total_frames = dataPairs.length;
    metadata.loop = loopCount;

    const pngData = fs.readFileSync(pair.pngPath);
    const frame = buildFrame(metadata, pngData);

    aedes.publish(
      {
        topic: CONFIG.mqttTopic,
        payload: frame,
        qos: 0,
        retain: false,
      },
      (err) => {
        if (err) console.error('[MQTT] Publish error:', err.message);
      }
    );

    totalPublished++;
    currentIndex++;

    if (currentIndex >= dataPairs.length) {
      currentIndex = 0;
      loopCount++;
      console.log(`[Stream] Loop ${loopCount} completed, restarting...`);
    }
  } catch (err) {
    console.error(`[Stream] Error publishing frame ${currentIndex}:`, err.message);
  }
}

function startStream() {
  if (streamState === State.RUNNING) return { ok: false, msg: 'Already running' };

  dataPairs = loadDataPairs(CONFIG.dataDir);
  if (dataPairs.length === 0) return { ok: false, msg: 'No data pairs found in ' + CONFIG.dataDir };

  currentIndex = 0;
  totalPublished = 0;
  loopCount = 0;
  streamState = State.RUNNING;
  publishTimer = setInterval(publishNext, CONFIG.publishIntervalMs);

  console.log(`[Stream] Started. ${dataPairs.length} frames loaded, interval=${CONFIG.publishIntervalMs}ms`);
  return { ok: true, msg: `Streaming started. ${dataPairs.length} data pairs loaded.` };
}

function stopStream() {
  if (streamState === State.IDLE) return { ok: false, msg: 'Already stopped' };
  clearInterval(publishTimer);
  publishTimer = null;
  streamState = State.IDLE;
  currentIndex = 0;
  totalPublished = 0;
  loopCount = 0;
  console.log('[Stream] Stopped.');
  return { ok: true, msg: 'Streaming stopped.' };
}

function pauseStream() {
  if (streamState !== State.RUNNING) return { ok: false, msg: 'Not running' };
  clearInterval(publishTimer);
  publishTimer = null;
  streamState = State.PAUSED;
  console.log('[Stream] Paused.');
  return { ok: true, msg: 'Streaming paused.' };
}

function resumeStream() {
  if (streamState !== State.PAUSED) return { ok: false, msg: 'Not paused' };
  streamState = State.RUNNING;
  publishTimer = setInterval(publishNext, CONFIG.publishIntervalMs);
  console.log('[Stream] Resumed.');
  return { ok: true, msg: 'Streaming resumed.' };
}

// ─── Express HTTP API ───────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/status', (_req, res) => {
  res.json({
    state: streamState,
    currentIndex,
    totalFrames: dataPairs.length,
    totalPublished,
    loopCount,
    config: {
      mqttTopic: CONFIG.mqttTopic,
      publishIntervalMs: CONFIG.publishIntervalMs,
      mqttTcpPort: CONFIG.mqttTcpPort,
      mqttWsPort: CONFIG.mqttWsPort,
    },
  });
});

app.post('/start', (_req, res) => {
  const result = startStream();
  res.status(result.ok ? 200 : 409).json(result);
});

app.post('/stop', (_req, res) => {
  const result = stopStream();
  res.status(result.ok ? 200 : 409).json(result);
});

app.post('/pause', (_req, res) => {
  const result = pauseStream();
  res.status(result.ok ? 200 : 409).json(result);
});

app.post('/resume', (_req, res) => {
  const result = resumeStream();
  res.status(result.ok ? 200 : 409).json(result);
});

// ─── Boot ───────────────────────────────────────────────────────────────────
mqttTcpServer.listen(CONFIG.mqttTcpPort, () => {
  console.log(`[MQTT-TCP]  Broker listening on tcp://0.0.0.0:${CONFIG.mqttTcpPort}`);
});

wsHttpServer.listen(CONFIG.mqttWsPort, () => {
  console.log(`[MQTT-WS]   Broker listening on ws://0.0.0.0:${CONFIG.mqttWsPort}`);
});

app.listen(CONFIG.httpPort, () => {
  console.log(`[HTTP]      Control API on http://0.0.0.0:${CONFIG.httpPort}`);
  console.log('');
  console.log('  GET  /status   - Query streaming state');
  console.log('  POST /start    - Begin MQTT streaming');
  console.log('  POST /stop     - Stop streaming');
  console.log('  POST /pause    - Pause streaming');
  console.log('  POST /resume   - Resume streaming');
  console.log('');
});
