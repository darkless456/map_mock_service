import type { RouteHandler } from '../shared/http';
import { hostBaseUrl, methodIs, readJsonBody, sendError, sendJson, sendOk, stringBodyField } from '../shared/http';
import { fixtureLoader } from '../../fixtures';
import { buildMapListResponse } from '../../fixtures/mapList.fixture';
import type { AppRouteContext } from '../router';

type DeviceSelfCheckPayload = Record<string, unknown> & {
  readonly checked_at?: number;
};

function readDeviceSelfCheckPayload(): DeviceSelfCheckPayload {
  return fixtureLoader.read('device/self_check.jsonc', raw => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('fixtures/device/self_check.jsonc must contain an object');
    }
    return raw as DeviceSelfCheckPayload;
  });
}

function buildDeviceDetail(req: Parameters<RouteHandler<AppRouteContext>>[0], ctx: AppRouteContext): Record<string, unknown> {
  const mapList = buildMapListResponse(hostBaseUrl(req, ctx.port)).data.items;
  const currentMap = mapList.find(map => map.is_use) ?? null;
  const device = ctx.robot.buildDeviceInfo();
  const recharge = ctx.robot.activeRechargeTask();
  // Recharge starts its return-to-dock sequence asynchronously. Before the first
  // NOTIFY_RATEL_STATUS frame reaches the FSM, the RECHARGE task is the authority
  // for the device-detail running state.
  const rechargeProjection = recharge?.status === 'ON_THE_WAY'
    ? { running_status: 'returning_charge', battery_charging: 0 }
    : {};

  return {
    ...device,
    ...rechargeProjection,
    courtyard_id: 'mock-courtyard-1',
    courtyard_name: 'Mock Courtyard',
    bound_map_count: currentMap ? 1 : 0,
    map_id: currentMap?.map_id ?? '',
    map_url: currentMap?.map_url ?? '',
  };
}

export const handleDeviceRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (url.pathname === '/ratel/api/v1/courtyard/robot/detail' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn');
    if (!sn) {
      sendError(res, 400, 'sn is required');
      return true;
    }
    if (sn !== ctx.robot.sn) {
      sendJson(res, 200, { code: 404, message: 'robot not found' });
      return true;
    }

    sendOk(res, buildDeviceDetail(req, ctx));
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
        ...readDeviceSelfCheckPayload(),
        checked_at: Date.now(),
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
