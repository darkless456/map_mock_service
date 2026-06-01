import http from 'node:http';
import { loadAllPatches } from './data/patches';
import { createHttpHandler } from './http/router';
import { ChaosController } from './sim/chaos';
import { MapStream } from './sim/mapStream';
import { Recorder } from './sim/recorder';
import { ScenarioEngine } from './sim/scenarioEngine';
import { VirtualRobot } from './sim/virtualRobot';
import { createWsServer } from './ws/wsServer';
import { logger } from './shared/logger';

const PORT = Number.parseInt(process.env.PORT || '9900', 10);
const MOCK_DATA_DIR = process.env.MOCK_DATA_DIR || 'data3';

logger.info(`Loading map patches from ${MOCK_DATA_DIR}/ ...`);
const patches = loadAllPatches(MOCK_DATA_DIR);
logger.info(`Loaded ${patches.length} map patches.`);

if (patches.length === 0) {
  logger.error(`No patches found in ${MOCK_DATA_DIR}/. Exiting.`);
  process.exit(1);
}

const robot = new VirtualRobot();
const mapStream = new MapStream(patches);
const chaos = new ChaosController();
const recorder = new Recorder();
recorder.attachRobot(robot);
const scenarioEngine = new ScenarioEngine({ robot, chaos, recorder });

const server = http.createServer(createHttpHandler({
  port: PORT,
  dataDir: MOCK_DATA_DIR,
  robot,
  mapStream,
  chaos,
  scenarioEngine,
  recorder,
}));

const wsRuntime = createWsServer({ server, robot, mapStream, chaos, recorder });
let shutdownStarted = false;

function shutdown(signal: NodeJS.Signals = 'SIGTERM'): void {
  if (shutdownStarted) {
    logger.warn(`Forced shutdown after repeated ${signal}`);
    process.exit(130);
  }

  shutdownStarted = true;
  logger.info(`Shutting down simulator (${signal})`);
  wsRuntime.close();

  const forceExitTimer = setTimeout(() => {
    logger.warn('Forcing simulator shutdown after timeout');
    process.exit(1);
  }, 2000);
  forceExitTimer.unref?.();

  server.close(err => {
    clearTimeout(forceExitTimer);
    if (err) {
      logger.error(`HTTP server close failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  });

  server.closeAllConnections?.();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Mower Dev Simulator running on http://0.0.0.0:${PORT}`);
  logger.info(`  Data dir:        ${MOCK_DATA_DIR}/`);
  logger.info(`  Robot SN:        ${robot.sn}`);
  logger.info('  Auth endpoint:   POST /ratel/api/v1/wss/acc_ticket');
  logger.info(`  WebSocket:       ws://localhost:${PORT}/acc?ticket=<ticket>`);
  logger.info(`  Health:          http://localhost:${PORT}/api/health`);
  if (process.env.SIM_PANEL !== '0') {
    logger.info(`  Control state:   http://localhost:${PORT}/sim/state`);
    logger.info(`  Control panel:   http://localhost:${PORT}/sim/panel`);
  }
});
