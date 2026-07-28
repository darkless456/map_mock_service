import type { RouteHandler } from '../shared/http';
import { hostBaseUrl, methodIs, readJsonBody, sendError, sendJson, sendOk, stringBodyField } from '../shared/http';
import { readBasemapAsset, readRealsceneAsset } from '../../assets/BasemapAsset';
import { buildMapListResponse } from '../../fixtures/mapList.fixture';
import { deleteSemanticOverride, type IncrementPackage } from '../../fixtures/semanticOverrides';
import { applySemanticSave } from '../../fixtures/semanticSave';
import { applyTopologyEdit } from '../../fixtures/topologyEdit';
import type { AppRouteContext } from '../router';

function isIncrementPackage(value: Record<string, unknown>): value is Record<string, unknown> & {
  map_id: string;
  increments: IncrementPackage['increments'];
} {
  return typeof value.map_id === 'string' && Array.isArray(value.increments);
}

export const handleMapRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (
    url.pathname === '/ratel/map-service/api/v1/ratel/map/list' &&
    methodIs(req, 'GET', 'POST')
  ) {
    sendJson(res, 200, buildMapListResponse(hostBaseUrl(req, ctx.port)));
    return true;
  }

  if (url.pathname === '/ratel/api/v1/map/topology/edit' && methodIs(req, 'POST')) {
    const result = applyTopologyEdit(await readJsonBody(req));
    if (!result.ok) {
      sendError(res, result.status, result.message);
      return true;
    }
    sendOk(res, {
      robot_code: 0,
      map_id: result.mapId,
      base_version: result.baseVersion,
      area_id: result.resultAreaId,
    });
    return true;
  }

  if (
    url.pathname === '/ratel/map-service/api/v1/ratel/semantic/save' &&
    methodIs(req, 'POST')
  ) {
    const body = await readJsonBody(req);
    if (!isIncrementPackage(body)) {
      sendError(res, 400, 'map_id and increments are required');
      return true;
    }
    // increments 是 delta，必须按 element_id 合并进现有地图，不能整包替换
    // （替换会把机器侧的 type=71 区域边界等一起抹掉，见 semanticSave.ts 文件头）。
    const result = applySemanticSave(body);
    if (!result.ok) {
      sendError(res, result.status, result.message);
      return true;
    }
    ctx.robot.dispatchRaw({ type: 'CMD_SAVE' }, 'mapping');
    sendOk(res, { base_version: result.baseVersion });
    return true;
  }

  // POST /map-service/api/v1/ratel_map/labels -- dynamic label list (mapping-v4-final-spec.md §6)
  if (url.pathname === '/map-service/api/v1/ratel_map/labels' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const mapId = stringBodyField(body, 'map_id') ?? 'mock_map_001';
    sendOk(res, { map_id: mapId, labels: ctx.robot.mappingLabelsList() });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/map/delete' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const mapId = stringBodyField(body, 'maps_id') ?? stringBodyField(body, 'map_id');
    if (!mapId) {
      sendError(res, 400, 'maps_id is required');
      return true;
    }
    deleteSemanticOverride(mapId);
    sendJson(res, 200, { code: 200, message: 'Success', data: { deleted: true, map_id: mapId } });
    return true;
  }

  if (url.pathname === '/sim/assets/full_semanticmap.png' && methodIs(req, 'GET')) {
    const asset = readBasemapAsset();
    if (!asset) {
      sendError(res, 503, 'full_semanticmap.png not found');
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': asset.length,
      'Cache-Control': 'no-store',
    });
    res.end(asset);
    return true;
  }

  if (url.pathname === '/sim/assets/full_rgbmap.png' && methodIs(req, 'GET')) {
    const asset = readRealsceneAsset();
    if (!asset) {
      sendError(res, 503, 'full_rgbmap.png not found');
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': asset.length,
      'Cache-Control': 'no-store',
    });
    res.end(asset);
    return true;
  }

  return false;
};
