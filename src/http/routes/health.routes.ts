import type { RouteHandler } from '../shared/http';
import { sendJson } from '../shared/http';
import type { AppRouteContext } from '../router';

export const handleHealthRoutes: RouteHandler<AppRouteContext> = (_req, res, url, ctx) => {
  if (url.pathname !== '/api/health') return false;
  const snapshot = ctx.robot.snapshot();
  sendJson(res, 200, {
    status: 'ok',
    simulator: 'mower-dev-simulator',
    dataDir: ctx.dataDir,
    patchCount: ctx.mapStream.patchCount,
    sn: snapshot.sn,
    work_status: snapshot.workStatus,
    activeDomain: snapshot.activeDomain,
    activeTask: snapshot.activeTask?.task_id ?? null,
  });
  return true;
};
