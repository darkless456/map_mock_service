import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendError, sendJson, stringBodyField } from '../shared/http';
import type { AppRouteContext } from '../router';
import { buildMappingCheckData } from './mappingCheck.builder';

function robotOkPayload(extra: Record<string, unknown> = {}) {
  return { robot_code: 0, robot_message: 'ok', ...extra };
}

export const handleMappingRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  // NOTE: `/ratel/api/v1/mapping/status` and `/ratel/api/v1/mapping/manual` are removed
  // (one-shot cutover, mapping-v4-final-spec.md §10). `robot/detail` is now the sole
  // sub_status/extend_status snapshot authority, and manual edge_start/region_closure
  // commands move to `ratel_mapping_task/action` (EDGE_START/EDGE_CLOSE). Unmatched
  // requests to the old paths fall through to the generic 404 below — no alias branch.

  // POST /ratel/api/v1/mapping/add_lawn -- add new lawn (record passageStartPoint)
  if (url.pathname === '/ratel/api/v1/mapping/add_lawn' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn') ?? ctx.robot.sn;
    if (!sn) { sendError(res, 400, 'sn is required'); return true; }
    ctx.robot.recordPassageStart();
    sendJson(res, 200, { code: 200, message: 'Success', data: robotOkPayload() });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/mapping/check' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn') ?? ctx.robot.sn;
    if (!sn) { sendError(res, 400, 'sn is required'); return true; }
    if (stringBodyField(body, 'sn')) { ctx.robot.updateDevice({ sn: stringBodyField(body, 'sn')! }); }
    sendJson(res, 200, { code: 200, message: 'Success', data: buildMappingCheckData(ctx.robot) });
    return true;
  }

  // NOTE: `/ratel/api/v1/mapping/expansion` is removed (v9 cutover). 地图编辑页「添加草坪」
  // 改走 `ratel_mapping_task/create` + `mode:'extend'`（mappingTask.routes.ts）——同一条建图
  // 任务链路、同样返回 task_id。旧路径不留兼容分支，落到下面的通用 404。

  // NOTE: `/ratel/api/v1/mapping/start|pause|resume|stop` are removed (one-shot cutover,
  // see 建图任务API重构方案.md §6.2). Replaced by
  // `ratel_mapping_task/create|action` (routes.mappingTask.ts). Unmatched requests to the
  // old paths fall through to the generic 404 below — no alias/back-compat branch here.

  if (url.pathname === '/ratel/api/v1/mapping/mode' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const mode = stringBodyField(body, 'mode') ?? 'auto';
    if (mode === 'remote') { ctx.robot.dispatchRaw({ type: 'CMD_SWITCH_MANUAL' }, 'mapping'); }
    else { ctx.robot.dispatchRaw({ type: 'CMD_EXIT_MANUAL' }, 'mapping'); }
    sendJson(res, 200, { code: 200, message: 'Success', data: robotOkPayload() });
    return true;
  }

  // GET /sim/assets/mapping_trajectory.bin -- mock trajectory file for recovery testing
  if (url.pathname === '/sim/assets/mapping_trajectory.bin' && methodIs(req, 'GET')) {
    const buf = ctx.robot.buildTrajectoryBinary();
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
    return true;
  }

  return false;
};
