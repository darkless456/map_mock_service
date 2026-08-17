import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendError, sendJson, stringBodyField } from '../shared/http';
import { createDatasetSwitcher } from '../../sim/mapStream';
import { MAPPING_EXPANSION_ACK_DELAY_MS } from '../../sim/SimulatorDefaults';
import type { AppRouteContext } from '../router';
import { buildMappingCheckData } from './mappingCheck.builder';
import { MAPPING_ERROR_STATUS } from './mappingErrors';

function robotOkPayload(extra: Record<string, unknown> = {}) {
  return { robot_code: 0, robot_message: 'ok', ...extra };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  // POST /ratel/api/v1/mapping/expansion -- 发起地图扩展（APP端接口文档 §9.1）：地图编辑页
  // 「添加草坪」。区别于 `ratel_mapping_task/action` 的 `EXPAND_AREA`（建图完成页入口，要求
  // sub_status === 'expand_area'）。§9.1 规定 PuduLink 只按 sn 取 MAC 后透传给设备，不查
  // map_id 是否存在、不落库，因此这里也不做地图存在性校验。
  if (url.pathname === '/ratel/api/v1/mapping/expansion' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn');
    const mapId = stringBodyField(body, 'map_id');
    // 「缺少参数」在下发前就被网关拒掉，不经过 MQTT，所以不走下面的等待回包延迟。
    if (!sn) { sendError(res, 400, 'sn is required'); return true; }
    if (!mapId) { sendError(res, 400, 'map_id is required'); return true; }
    // §9.1: PuduLink 下发后同步等待设备回包才响应。
    await delay(MAPPING_EXPANSION_ACK_DELAY_MS);
    const error = ctx.robot.startMappingExpansion(
      { sn, mapId },
      { switchDataset: createDatasetSwitcher(ctx.mapStream) },
    );
    if (error) {
      const status = MAPPING_ERROR_STATUS[error.kind];
      sendError(res, status, error.message, status, {
        data: { robot_code: -1, robot_message: error.message },
      });
      return true;
    }
    // §9.1 成功示例只有 code/message —— `data` 仅在设备拒绝执行时出现，因此这里刻意不带
    // `robotOkPayload()`（与同文件其它路由不同）。
    sendJson(res, 200, { code: 200, message: 'SUCCESS' });
    return true;
  }

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
