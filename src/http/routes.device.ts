import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendJson, sendOk, stringBodyField } from '../shared/http';
import type { AppRouteContext } from './router';

export const handleDeviceRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (url.pathname === '/ratel/api/v1/courtyard/robot/detail' && methodIs(req, 'GET', 'POST')) {
    sendOk(res, ctx.robot.buildDeviceInfo());
    return true;
  }

  if (url.pathname === '/ratel/api/v1/courtyard/robot/info/update' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    ctx.robot.updateDevice(body);
    sendOk(res, ctx.robot.buildDeviceInfo());
    return true;
  }

  if (url.pathname === '/ratel/api/v1/robot/self_check' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = typeof body.sn === 'string' ? body.sn.trim() : '';
    if (sn) {
      ctx.robot.updateDevice({ sn });
    }
    ctx.robot.beginMappingPrepareSelfCheck();
    sendJson(res, 200, {
      code: 200,
      message: 'Success',
      data: {
        checked_at: Date.now(),
        blade: 'normal',
        wheel: 'normal',
        sensor: 'normal',
        motor: 'normal',
        gps: 'normal',
        overall: 'ok',
      },
    });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/courtyard/robot/unbind' && methodIs(req, 'POST')) {
    ctx.robot.dispatchRaw({ type: 'LINK_BLE_DOWN' }, ctx.robot.activeDomain);
    ctx.robot.reset();
    sendJson(res, 200, { code: 200, message: 'Success', data: { robot_code: 0, robot_message: 'ok' } });
    return true;
  }

  return false;
};
