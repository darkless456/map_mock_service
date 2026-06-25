import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendError, sendJson, stringBodyField } from '../shared/http';
import type { AppRouteContext } from './router';
import { buildMappingCheckData } from './mappingCheckResponse';

function robotOkPayload(extra: Record<string, unknown> = {}) {
  return { robot_code: 0, robot_message: 'ok', ...extra };
}

export const handleMappingRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  // POST /ratel/api/v1/mapping/status -- recovery status query (mapping_api_dvt_gap.md 4)
  if (url.pathname === '/ratel/api/v1/mapping/status' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn') ?? ctx.robot.sn;
    if (!sn) { sendError(res, 400, 'sn is required'); return true; }
    const snap = ctx.robot.snapshot();
    const isMapping = snap.workStatus === 'mapping';
    const baseUrl = ctx.port ? `http://localhost:${ctx.port}` : '';
    sendJson(res, 200, { code: 200, message: 'Success', data: isMapping ? {
      work_status: 'mapping', sub_status: ctx.robot.lastNotifySubStatus ?? 'edge_mapping',
      map_id: 'mock_map_001', mode: snap.mapping.mode ?? 'auto',
      in_lawn: ctx.robot.inLawn ? 1 : 0,
      trajectory_url: ctx.robot.generateTrajectoryUrl(baseUrl),
      passage_checkpoints: ctx.robot.passageCheckpoints,
    } : { work_status: 'idle' } });
    return true;
  }

  // POST /ratel/api/v1/mapping/manual -- manual mapping commands (edge_start / region_closure)
  if (url.pathname === '/ratel/api/v1/mapping/manual' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn') ?? ctx.robot.sn;
    if (!sn) { sendError(res, 400, 'sn is required'); return true; }
    const edgeStart = body.edge_start === 1 || body.edge_start === true || body.edge_start === '1';
    const regionClosure = body.region_closure === 1 || body.region_closure === true || body.region_closure === '1';
    if (edgeStart) ctx.robot.confirmEdgeStart();
    if (regionClosure) ctx.robot.confirmRegionClosure();
    sendJson(res, 200, { code: 200, message: 'Success', data: robotOkPayload({ edge_start: edgeStart, region_closure: regionClosure }) });
    return true;
  }

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

  if (url.pathname === '/ratel/api/v1/mapping/start' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn') ?? ctx.robot.sn;
    const mode = stringBodyField(body, 'mode') ?? 'auto';
    const mapId = stringBodyField(body, 'map_id') ?? undefined;
    if (!sn) { sendError(res, 400, 'sn is required'); return true; }
    ctx.robot.startMapping({ sn, mode, map_id: mapId });
    ctx.robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'precondition' });
    sendJson(res, 200, { code: 200, message: 'Success', data: robotOkPayload({ map_id: mapId ?? 'mock_map_001' }) });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/mapping/pause' && methodIs(req, 'POST')) {
    ctx.robot.pauseMapping();
    sendJson(res, 200, { code: 200, message: 'Success', data: robotOkPayload() });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/mapping/resume' && methodIs(req, 'POST')) {
    ctx.robot.resumeMapping();
    sendJson(res, 200, { code: 200, message: 'Success', data: robotOkPayload() });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/mapping/stop' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const save = body.save === true || body.save === 1 || body.save === '1';
    ctx.robot.dispatchRaw({ type: save ? 'CMD_CONFIRM' : 'CMD_CANCEL' }, 'mapping');
    sendJson(res, 200, { code: 200, message: 'Success', data: robotOkPayload() });
    return true;
  }

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
