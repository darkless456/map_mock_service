import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendError, sendJson, stringBodyField } from '../shared/http';
import type { AppRouteContext } from './router';
import { buildMappingCheckData } from './mappingCheckResponse';

function robotOkPayload(extra: Record<string, unknown> = {}) {
  return { robot_code: 0, robot_message: 'ok', ...extra };
}

export const handleMappingRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (url.pathname === '/ratel/api/v1/mapping/check' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn') ?? ctx.robot.sn;
    if (!sn) {
      sendError(res, 400, 'sn is required');
      return true;
    }
    if (stringBodyField(body, 'sn')) {
      ctx.robot.updateDevice({ sn: stringBodyField(body, 'sn')! });
    }
    sendJson(res, 200, {
      code: 200,
      message: 'Success',
      data: buildMappingCheckData(ctx.robot),
    });
    return true;
  }

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
    ctx.robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'precondition' });
    sendJson(res, 200, {
      code: 200,
      message: 'Success',
      data: robotOkPayload({ map_id: mapId ?? 'mock_map_001' }),
    });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/mapping/pause' && methodIs(req, 'POST')) {
    ctx.robot.pauseMapping();
    sendJson(res, 200, {
      code: 200,
      message: 'Success',
      data: robotOkPayload(),
    });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/mapping/resume' && methodIs(req, 'POST')) {
    ctx.robot.dispatchRaw({ type: 'CMD_RESUME' }, 'mapping');
    sendJson(res, 200, {
      code: 200,
      message: 'Success',
      data: robotOkPayload(),
    });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/mapping/stop' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const save = body.save === true || body.save === 1 || body.save === '1';
    ctx.robot.dispatchRaw({ type: save ? 'CMD_CONFIRM' : 'CMD_CANCEL' }, 'mapping');
    sendJson(res, 200, {
      code: 200,
      message: 'Success',
      data: robotOkPayload(),
    });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/mapping/mode' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const mode = stringBodyField(body, 'mode') ?? 'auto';
    if (mode === 'remote') {
      ctx.robot.dispatchRaw({ type: 'CMD_SWITCH_MANUAL' }, 'mapping');
    } else {
      ctx.robot.dispatchRaw({ type: 'CMD_EXIT_MANUAL' }, 'mapping');
    }
    sendJson(res, 200, {
      code: 200,
      message: 'Success',
      data: robotOkPayload(),
    });
    return true;
  }

  return false;
};
