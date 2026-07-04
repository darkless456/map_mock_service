import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { VirtualRobot } from '../sim/virtualRobot';
import type { MapStream } from '../sim/mapStream';
import type { ChaosController } from '../sim/chaos';
import type { ScenarioEngine } from '../sim/scenarioEngine';
import type { Recorder } from '../sim/recorder';
import { setCorsHeaders, sendError, type HttpRouteDeps, type RouteHandler } from './shared/http';
import { handleAccRoutes } from './routes/auth.routes';
import { handleHealthRoutes } from './routes/health.routes';
import { handleDeviceRoutes } from './routes/device.routes';
import { handleMapRoutes } from './routes/map.routes';
import { handleMappingRoutes } from './routes/mapping.routes';
import { handleMappingTaskRoutes } from './routes/mappingTask.routes';
import { handleTaskRoutes } from './routes/task.routes';
import { handleRechargeRoutes } from './routes/recharge.routes';
import { handleSimRoutes } from './routes/sim.routes';

export interface AppRouteContext extends HttpRouteDeps {
  readonly port: number;
  readonly dataDir: string;
  readonly robot: VirtualRobot;
  readonly mapStream: MapStream;
  readonly chaos: ChaosController;
  readonly scenarioEngine: ScenarioEngine;
  readonly recorder: Recorder;
}

const ROUTES: readonly RouteHandler<AppRouteContext>[] = [
  handleHealthRoutes,
  handleAccRoutes,
  handleDeviceRoutes,
  handleMapRoutes,
  handleMappingRoutes,
  handleMappingTaskRoutes,
  handleTaskRoutes,
  handleRechargeRoutes,
  handleSimRoutes,
];

export function createHttpHandler(ctx: AppRouteContext) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host || `localhost:${ctx.port}`}`);
    try {
      ctx.recorder.recordHttp(req, url.pathname);
      const delayMs = shouldDelayHttp(url.pathname) ? ctx.chaos.httpDelayMs() : 0;
      if (delayMs > 0) await delay(delayMs);
      for (const route of ROUTES) {
        if (await route(req, res, url, ctx)) return;
      }
      sendError(res, 404, 'deprecated; removed in simulator v1');
    } catch (error) {
      const message = error instanceof SyntaxError
        ? 'Invalid JSON body'
        : error instanceof Error
          ? error.message
          : String(error);
      sendError(res, error instanceof SyntaxError ? 400 : 500, message);
    }
  };
}

function shouldDelayHttp(pathname: string): boolean {
  return pathname !== '/api/health' && !pathname.startsWith('/sim/');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
