const aedes = require('aedes')();
const { createServer } = require('net');
const http = require('http');
const ws = require('websocket-stream');

const TOPICS = {
  FRAME: 'slam/local_map/frame',
  STATUS: 'slam/local_map/status',
  CMD: 'slam/playback/cmd',
};

function startMqttServer(engine, { tcpPort = 1883, wsPort = 8083 } = {}) {
  // TCP transport
  const tcpServer = createServer(aedes.handle);
  tcpServer.listen(tcpPort, () => {
    console.log(`[MQTT] TCP broker listening on port ${tcpPort}`);
  });

  // WebSocket transport (for React Native / browser clients)
  const httpServer = http.createServer();
  ws.createServer({ server: httpServer }, aedes.handle);
  httpServer.listen(wsPort, () => {
    console.log(`[MQTT] WebSocket broker listening on port ${wsPort}`);
  });

  // Publish binary frames from playback engine
  engine.on('frame', (binaryPayload) => {
    aedes.publish({
      topic: TOPICS.FRAME,
      payload: binaryPayload,
      qos: 0,
      retain: false,
    });
  });

  engine.on('status', (status) => {
    aedes.publish({
      topic: TOPICS.STATUS,
      payload: JSON.stringify(status),
      qos: 0,
      retain: true,
    });
  });

  // Handle client commands via MQTT
  aedes.on('publish', (packet, client) => {
    if (!client) return; // ignore internal publishes
    if (packet.topic === TOPICS.CMD) {
      try {
        const cmd = JSON.parse(packet.payload.toString());
        handleCommand(engine, cmd);
      } catch (e) {
        console.error('[MQTT] Invalid command payload:', e.message);
      }
    }
  });

  aedes.on('client', (client) => {
    console.log(`[MQTT] Client connected: ${client.id}`);
  });

  aedes.on('clientDisconnect', (client) => {
    console.log(`[MQTT] Client disconnected: ${client.id}`);
  });

  return { aedes, tcpServer, httpServer, TOPICS };
}

function handleCommand(engine, cmd) {
  switch (cmd.action) {
    case 'start':
      engine.start();
      break;
    case 'pause':
      engine.pause();
      break;
    case 'resume':
      engine.resume();
      break;
    case 'stop':
      engine.stop();
      break;
    case 'set_speed':
      if (typeof cmd.speed === 'number') engine.setSpeed(cmd.speed);
      break;
    case 'seek':
      if (typeof cmd.timestamp === 'number') engine.seek(cmd.timestamp);
      break;
    case 'set_loop':
      engine.setLoop(!!cmd.loop);
      break;
    default:
      console.warn(`[MQTT] Unknown command: ${cmd.action}`);
  }
}

module.exports = { startMqttServer, handleCommand, TOPICS };
