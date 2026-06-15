import type { RouteHandler } from '../shared/http';
import { hostBaseUrl, methodIs, readJsonBody, sendError, sendJson, sendOk, stringBodyField } from '../shared/http';
import { buildMapList, readBasemapAsset, readRealsceneAsset } from '../data/basemap';
import { deleteAnnotationPackage, setAnnotationPackage, type IncrementPackage } from '../data/annotations';
import type { AppRouteContext } from './router';

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
    sendOk(res, buildMapList(hostBaseUrl(req, ctx.port)));
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
    const pkg: IncrementPackage = {
      map_id: body.map_id,
      base_version: typeof body.base_version === 'number' ? body.base_version + 1 : 1,
      timestamp: Date.now(),
      unit: typeof body.unit === 'string' ? body.unit as IncrementPackage['unit'] : 'meter',
      increments: body.increments,
    };
    setAnnotationPackage(pkg.map_id, pkg);
    ctx.robot.dispatchRaw({ type: 'CMD_SAVE' }, 'mapping');
    sendOk(res, { base_version: pkg.base_version });
    return true;
  }

  if (url.pathname === '/ratel/api/v1/map/delete' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const mapId = stringBodyField(body, 'maps_id') ?? stringBodyField(body, 'map_id');
    if (!mapId) {
      sendError(res, 400, 'maps_id is required');
      return true;
    }
    deleteAnnotationPackage(mapId);
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
