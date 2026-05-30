import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendError, sendJson, stringBodyField } from '../shared/http';
import { applyTaskAction, buildTaskListData, createMowingTask } from '../sim/taskBridge';
import type { AppRouteContext } from './router';

const TASK_BASE = '/ratel/central-control-service/api/v1/ratel_task';

export const handleTaskRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (url.pathname === `${TASK_BASE}/create` && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const result = createMowingTask(ctx.robot, body);
    if (!result.task) {
      sendError(res, 400, result.error ?? 'invalid task create body');
      return true;
    }
    sendJson(res, 200, {
      code: 200,
      message: '',
      data: {
        task_id: result.task.task_id,
        robot_code: 0,
        robot_message: 'ok',
      },
    });
    return true;
  }

  if (url.pathname === `${TASK_BASE}/action` && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const result = applyTaskAction(ctx.robot, body);
    if (result.error) {
      sendJson(res, 200, {
        code: 400,
        message: result.error,
        data: { robot_code: -1, robot_message: result.error },
      });
      return true;
    }
    sendJson(res, 200, {
      code: 200,
      message: '',
      data: { robot_code: 0, robot_message: 'ok' },
    });
    return true;
  }

  if (url.pathname === `${TASK_BASE}/list` && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn') ?? undefined;
    sendJson(res, 200, { code: 200, message: '', data: buildTaskListData(ctx.robot, sn) });
    return true;
  }

  return false;
};
