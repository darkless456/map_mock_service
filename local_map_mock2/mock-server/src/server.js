'use strict';

const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs/promises');

const aedesFactory = require('aedes');
const express = require('express');
const WebSocket = require('ws');
const websocketStream = require('websocket-stream');

const { TOPIC_INCREMENT } = require('./constants');
const { buildIncrementFrame } = require('./frame');
const { xmlMapMetaToJson } = require('./xmlToJson');
const { loadDataPairs } = require('./dataPairs');

const PORT_HTTP = Number(process.env.PORT_HTTP || 3000);
const PORT_MQTT_TCP = Number(process.env.PORT_MQTT_TCP || 1883);
const PORT_MQTT_WS = Number(process.env.PORT_MQTT_WS || 8883);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DEFAULT_HZ = Number(process.env.MOCK_HZ || 10);

/** @type {import('aedes').Aedes | null} */
let broker = null;
/** @type {import('http').Server | null} */
let httpServer = null;
/** @type {import('net').Server | null} */
let tcpServer = null;
/** @type {import('http').Server | null} */
let mqttWsStandalone = null;
/** @type {WebSocket.Server | null} */
let wssMqttPort = null;

const streamState = {
  running: false,
  paused: false,
  hz: DEFAULT_HZ,
  dataDir: DATA_DIR,
  pairs: /** @type {Awaited<ReturnType<typeof loadDataPairs>>} */ ([]),
  index: 0,
  sentCount: 0,
  timer: /** @type {ReturnType<typeof setInterval> | null} */ (null),
  lastError: /** @type {string | null} */ (null),
  lastTopic: TOPIC_INCREMENT,
};

function brokerClientCount() {
  if (!broker) return { connected: 0 };
  return { connected: broker.connectedClients };
}

function publishIncrement(payload) {
  return new Promise((resolve, reject) => {
    if (!broker) {
      reject(new Error('Broker not ready'));
      return;
    }
    broker.publish(
      {
        topic: streamState.lastTopic,
        payload,
        qos: 0,
        retain: false,
      },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function tickSend() {
  if (!streamState.running || streamState.paused) return;
  if (streamState.pairs.length === 0) {
    streamState.lastError = 'No PNG/XML pairs in data directory';
    return;
  }

  const pair = streamState.pairs[streamState.index % streamState.pairs.length];
  try {
    const [xmlText, pngBuf] = await Promise.all([
      fs.readFile(pair.xmlPath, 'utf8'),
      fs.readFile(pair.pngPath),
    ]);
    const meta = xmlMapMetaToJson(xmlText);
    const jsonUtf8 = Buffer.from(JSON.stringify(meta), 'utf8');
    const frame = buildIncrementFrame(jsonUtf8, pngBuf);
    await publishIncrement(frame);
    streamState.sentCount += 1;
    streamState.index = (streamState.index + 1) % streamState.pairs.length;
    streamState.lastError = null;
  } catch (e) {
    streamState.lastError = e instanceof Error ? e.message : String(e);
  }
}

function clearTimer() {
  if (streamState.timer) {
    clearInterval(streamState.timer);
    streamState.timer = null;
  }
}

function startTimer() {
  clearTimer();
  const ms = Math.max(1, Math.round(1000 / streamState.hz));
  streamState.timer = setInterval(() => {
    void tickSend();
  }, ms);
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  app.get('/status', (_req, res) => {
    res.json({
      running: streamState.running,
      paused: streamState.paused,
      hz: streamState.hz,
      dataDir: path.resolve(streamState.dataDir),
      pairCount: streamState.pairs.length,
      index: streamState.index,
      sentCount: streamState.sentCount,
      lastError: streamState.lastError,
      topic: streamState.lastTopic,
      mqtt: {
        tcpPort: PORT_MQTT_TCP,
        wsPort: PORT_MQTT_WS,
        clients: brokerClientCount(),
      },
    });
  });

  app.post('/start', async (req, res) => {
    try {
      const hz = req.body?.hz != null ? Number(req.body.hz) : streamState.hz;
      const dataDir = req.body?.dataDir != null ? String(req.body.dataDir) : streamState.dataDir;
      const topic =
        req.body?.topic != null && String(req.body.topic).length > 0
          ? String(req.body.topic)
          : TOPIC_INCREMENT;

      if (!Number.isFinite(hz) || hz <= 0 || hz > 120) {
        res.status(400).json({ ok: false, error: 'hz must be in (0, 120]' });
        return;
      }

      streamState.hz = hz;
      streamState.dataDir = dataDir;
      streamState.lastTopic = topic;
      streamState.pairs = await loadDataPairs(dataDir);
      streamState.index = 0;
      streamState.sentCount = 0;
      streamState.paused = false;
      streamState.running = true;
      streamState.lastError = streamState.pairs.length ? null : 'No pairs found';
      startTimer();
      res.json({ ok: true, pairCount: streamState.pairs.length, hz: streamState.hz, topic: streamState.lastTopic });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/stop', (_req, res) => {
    streamState.running = false;
    streamState.paused = false;
    clearTimer();
    res.json({ ok: true });
  });

  app.post('/pause', (_req, res) => {
    if (!streamState.running) {
      res.status(400).json({ ok: false, error: 'Not running' });
      return;
    }
    streamState.paused = true;
    res.json({ ok: true });
  });

  app.post('/resume', (_req, res) => {
    if (!streamState.running) {
      res.status(400).json({ ok: false, error: 'Not running' });
      return;
    }
    streamState.paused = false;
    res.json({ ok: true });
  });

  return app;
}

async function main() {
  broker = aedesFactory();

  tcpServer = net.createServer(broker.handle);
  await new Promise((resolve, reject) => {
    tcpServer.listen(PORT_MQTT_TCP, (err) => (err ? reject(err) : resolve()));
  });

  const app = buildApp();
  httpServer = http.createServer(app);

  await new Promise((resolve, reject) => {
    httpServer.listen(PORT_HTTP, (err) => (err ? reject(err) : resolve()));
  });

  // Dedicated HTTP server for MQTT-over-WebSocket (e.g. port 8883) for RN / browser clients
  mqttWsStandalone = http.createServer();
  wssMqttPort = new WebSocket.Server({ server: mqttWsStandalone });
  wssMqttPort.on('connection', (socket) => {
    const stream = websocketStream(socket);
    broker.handle(stream);
  });
  await new Promise((resolve, reject) => {
    mqttWsStandalone.listen(PORT_MQTT_WS, (err) => (err ? reject(err) : resolve()));
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        msg: 'robot-map-mock-server ready',
        rest: `http://127.0.0.1:${PORT_HTTP}`,
        mqttTcp: `mqtt://127.0.0.1:${PORT_MQTT_TCP}`,
        mqttWs: `ws://127.0.0.1:${PORT_MQTT_WS}`,
        dataDirDefault: path.resolve(DATA_DIR),
      },
      null,
      2
    )
  );
}

function shutdown() {
  clearTimer();
  try {
    wssMqttPort?.close();
  } catch {
    /* ignore */
  }
  try {
    mqttWsStandalone?.close();
  } catch {
    /* ignore */
  }
  try {
    tcpServer?.close();
  } catch {
    /* ignore */
  }
  try {
    httpServer?.close();
  } catch {
    /* ignore */
  }
  try {
    broker?.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
