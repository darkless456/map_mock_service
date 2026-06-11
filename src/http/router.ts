import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { VirtualRobot } from '../sim/virtualRobot';
import type { MapStream } from '../sim/mapStream';
import type { ChaosController } from '../sim/chaos';
import type { ScenarioEngine } from '../sim/scenarioEngine';
import type { Recorder } from '../sim/recorder';
import { setCorsHeaders, sendError, type HttpRouteDeps, type RouteHandler } from '../shared/http';
import { handleAccRoutes } from './routes.acc';
import { handleHealthRoutes } from './routes.health';
import { handleDeviceRoutes } from './routes.device';
import { handleMapRoutes } from './routes.map';
import { handleMappingRoutes } from './routes.mapping';
import { handleTaskRoutes } from './routes.task';
import { handleRechargeRoutes } from './routes.recharge';
import { handleSimRoutes } from './routes.sim';

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
