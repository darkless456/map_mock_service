import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import type { VirtualRobot } from '../sim/virtualRobot';
import type { MapStream } from '../sim/mapStream';
import type { ChaosController } from '../sim/chaos';
import type { ScenarioEngine } from '../sim/scenarioEngine';
import type { Recorder } from '../sim/recorder';
import { setCorsHeaders, sendError, type HttpRouteDeps, type RouteHandler } from './shared/http';
import { handleAccRoutes } from './routes/auth.routes';
import { handleLoginRoutes } from './routes/login.routes';
import { handleHealthRoutes } from './routes/health.routes';
import { handleDeviceRoutes } from './routes/device.routes';
import { handleMapRoutes } from './routes/map.routes';
import { handleMappingRoutes } from './routes/mapping.routes';
import { handleMappingTaskRoutes } from './routes/mappingTask.routes';
import { handleTrackRoutes } from './routes/track.routes';
import { handleTaskRoutes } from './routes/task.routes';
import { handleRechargeRoutes } from './routes/recharge.routes';
import { handleSimRoutes } from './routes/sim.routes';
import {
  captureRequestPayload,
  isBusinessRequest,
  queryRecord,
  requestEchoEnabled,
  runWithRequestDebug,
  sanitizeDebugPayload,
  type RequestDebugContext,
} from './requestDebug';
import { logger } from '../infra/logger';

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
  handleLoginRoutes,
  handleDeviceRoutes,
  handleMapRoutes,
  handleMappingRoutes,
  handleMappingTaskRoutes,
  handleTrackRoutes,
  handleTaskRoutes,
  handleRechargeRoutes,
  handleSimRoutes,
];

export function createHttpHandler(ctx: AppRouteContext) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host || `localhost:${ctx.port}`}`);
    const requestDebug: RequestDebugContext = {
      requestId: randomUUID(),
      method: req.method?.toUpperCase() ?? 'GET',
      path: url.pathname,
      query: queryRecord(url.searchParams),
      echoEnabled: requestEchoEnabled(req),
      requestPayload: null,
    };

    return runWithRequestDebug(requestDebug, async () => {
      const startedAt = Date.now();
      setCorsHeaders(res);
      res.setHeader('X-Mock-Request-Id', requestDebug.requestId);
      try {
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        requestDebug.requestPayload = await captureRequestPayload(req);
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
      } finally {
        const entry = {
          requestId: requestDebug.requestId,
          method: requestDebug.method,
          path: requestDebug.path,
          query: requestDebug.query,
          requestPayload: sanitizeDebugPayload(requestDebug.requestPayload),
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
        };
        ctx.recorder.recordHttp(entry);
        if (isBusinessRequest(url.pathname)) logger.info('HTTP request', entry);
      }
    });
  };
}

function shouldDelayHttp(pathname: string): boolean {
  return pathname !== '/api/health' && !pathname.startsWith('/sim/');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
