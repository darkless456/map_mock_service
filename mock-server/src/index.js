const fs = require('fs');
const path = require('path');
const { PlaybackEngine } = require('./playback-engine');
const { startMqttServer } = require('./mqtt-server');
const { startWsServer } = require('./ws-server');
const { createRestApi } = require('./rest-api');

const FRAMES_FILE = process.env.FRAMES_FILE || path.resolve(__dirname, '..', 'data', 'frames.json');

const CONFIG = {
  rest: { port: parseInt(process.env.REST_PORT) || 8080 },
  ws: { port: parseInt(process.env.WS_PORT) || 8082 },
  mqtt: {
    tcpPort: parseInt(process.env.MQTT_TCP_PORT) || 1883,
    wsPort: parseInt(process.env.MQTT_WS_PORT) || 8083,
  },
};

function loadFrames() {
  if (!fs.existsSync(FRAMES_FILE)) {
    console.error(`[ERROR] ${FRAMES_FILE} not found.`);
    console.error('Run "npm run preprocess" first to generate frames.json from XML files.');
    process.exit(1);
  }
  const raw = fs.readFileSync(FRAMES_FILE, 'utf-8');
  const frames = JSON.parse(raw);
  console.log(`[DATA] Loaded ${frames.length} frames`);
  return frames;
}

function main() {
  const frames = loadFrames();
  const engine = new PlaybackEngine(frames);

  createRestApi(frames, engine, CONFIG.rest);
  startWsServer(engine, CONFIG.ws);
  startMqttServer(engine, CONFIG.mqtt);

  console.log('\n--- SLAM Mock Server Ready ---');
  console.log(`  REST API:        http://localhost:${CONFIG.rest.port}`);
  console.log(`  WebSocket:       ws://localhost:${CONFIG.ws.port}`);
  console.log(`  MQTT TCP:        mqtt://localhost:${CONFIG.mqtt.tcpPort}`);
  console.log(`  MQTT WebSocket:  ws://localhost:${CONFIG.mqtt.wsPort}`);
  console.log('\nEndpoints:');
  console.log('  GET  /api/metadata          - Dataset info');
  console.log('  GET  /api/frames?page=&size= - Paginated frames');
  console.log('  GET  /api/frames/range?start=&end= - Time range query');
  console.log('  GET  /api/frames/:timestamp - Single frame');
  console.log('  POST /api/playback/start    - Start playback');
  console.log('  POST /api/playback/pause    - Pause playback');
  console.log('  POST /api/playback/resume   - Resume playback');
  console.log('  POST /api/playback/stop     - Stop playback');
  console.log('  POST /api/playback/speed    - Set speed { speed: N }');
  console.log('  POST /api/playback/seek     - Seek { timestamp: N }');
  console.log('  GET  /api/playback/status   - Playback status');
  console.log('\nMQTT Topics:');
  console.log('  slam/local_map/frame   - Frame data (subscribe)');
  console.log('  slam/local_map/status  - Playback status (subscribe)');
  console.log('  slam/playback/cmd      - Control commands (publish)');
}

main();
