import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendError, sendJson, stringBodyField } from '../shared/http';
import type { AppRouteContext } from './router';

export const handleMappingRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (url.pathname === '/ratel/api/v1/mapping/start' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn') ?? ctx.robot.sn;
    const mode = stringBodyField(body, 'mode') ?? 'auto';
    const mapId = stringBodyField(body, 'map_id') ?? undefined;
    if (!sn) {
      sendError(res, 400, 'sn is required');
      return true;
    }
    ctx.robot.startMapping({ sn, mode, map_id: mapId });
    sendJson(res, 200, {
      code: 200,
      message: 'Success',
      data: { robot_code: 0, robot_message: 'ok', map_id: mapId ?? 'mock_map_001' },
    });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/mapping/pause' && methodIs(req, 'POST')) {
    ctx.robot.pauseMapping();
    sendJson(res, 200, {
      code: 200,
      message: 'Success',
      data: { robot_code: 0, robot_message: 'ok' },
    });
    return true;
  }

  return false;
};
