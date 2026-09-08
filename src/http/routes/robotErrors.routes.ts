import type { AppRouteContext } from '../router';
import type { RouteHandler } from '../shared/http';
import {
  methodIs,
  numberBodyField,
  readJsonBody,
  sendError,
  sendOk,
  stringBodyField,
} from '../shared/http';

const UNHANDLED_ROBOT_ERRORS_PATH = '/ratel/api/v1/robot/errors/unhandled';

export const handleRobotErrorRoutes: RouteHandler<AppRouteContext> = async (
  req,
  res,
  url,
  ctx,
) => {
  if (
    url.pathname !== UNHANDLED_ROBOT_ERRORS_PATH ||
    !methodIs(req, 'POST')
  ) {
    return false;
  }

  const body = await readJsonBody(req);
  const sn = stringBodyField(body, 'sn');
  if (!sn) {
    sendError(res, 400, 'sn is required');
    return true;
  }
  if (sn !== ctx.robot.sn) {
    sendOk(res, { total: 0, items: [] });
    return true;
  }

  const offset = Math.max(0, Math.trunc(numberBodyField(body, 'offset') ?? 0));
  const limit = Math.max(1, Math.trunc(numberBodyField(body, 'limit') ?? 20));
  const active = ctx.robot.activeRobotErrors();
  const items = active.slice(offset, offset + limit).map(error => ({
    id: error.id,
    sn: error.sn,
    callback_type: 'ROBOT_ERROR',
    error_type: error.errorType,
    data: {
      sn: error.sn,
      error_id: error.errorId,
      error_type: error.errorType,
      error_level: error.errorLevel,
      task_message: error.message,
      notify_timestamp: error.notifyTimestamp,
    },
    created_at: error.createdAt,
  }));

  sendOk(res, { total: active.length, items });
  return true;
};

