import type { RouteHandler } from '../shared/http';
import { methodIs, numberBodyField, readJsonBody, sendError, sendJson, stringBodyField } from '../shared/http';
import type { AppRouteContext } from '../router';

// mapping_snapshot_recovery_design.md §8.1 / §19.5: the mock exposes this WITHOUT the
// `/ratel` gateway prefix that the app-side endpoint constant carries.
const TRACK_QUERY_PATH = '/location-collection-service/api/location/track/query';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * `POST /location-collection-service/api/location/track/query`
 * — historical mapping trajectory for recovery backfill (design §8).
 *
 * Fault injection is driven by the robot's track-query scenario (see MappingTrackHistory
 * and `POST /sim/track-query`). `mode: 'error'` / `delayMs` are enforced here; all point
 * shaping happens in `robot.trackQuery`.
 */
export const handleTrackRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (url.pathname !== TRACK_QUERY_PATH || !methodIs(req, 'POST')) return false;

  const body = await readJsonBody(req);
  const startTs = numberBodyField(body, 'start_timestamp');
  const endTs = numberBodyField(body, 'end_timestamp');
  // Contract: end_timestamp must be strictly greater than start_timestamp (design §8.1 —
  // this is exactly the 400 the app's T0 clamp is meant to avoid).
  if (startTs !== null && endTs !== null && endTs <= startTs) {
    sendError(res, 400, 'end_timestamp must be greater than start_timestamp');
    return true;
  }

  const scenario = ctx.robot.trackQueryScenario();
  if (scenario.mode === 'error') {
    sendError(res, scenario.errorStatus, 'injected track query failure');
    return true;
  }
  if (scenario.delayMs > 0) await delay(scenario.delayMs);

  const mapId =
    stringBodyField(body, 'map_id') ?? ctx.robot.activeMappingTask()?.map_id ?? 'mock_map_001';
  const limit = numberBodyField(body, 'limit') ?? 20000;
  const offset = numberBodyField(body, 'offset') ?? 0;

  const list = ctx.robot.trackQuery({ mapId, limit, offset });
  sendJson(res, 200, { code: 200, message: 'success', data: { list, total: list.length } });
  return true;
};
