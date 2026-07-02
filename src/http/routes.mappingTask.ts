import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendError, sendJson, stringBodyField } from '../shared/http';
import { applyMappingTaskAction, buildMappingTaskListData, createMappingTask } from '../sim/mappingTaskBridge';
import type { AppRouteContext } from './router';

const MAPPING_TASK_BASE = '/ratel/central-control-service/api/v1/ratel_mapping_task';
// 与割草任务列表一致的坑点：后端 limit 缺省为 0 会返回空列表，mock 侧同样要求显式默认值。
const DEFAULT_LIMIT = 10;

export const handleMappingTaskRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (url.pathname === `${MAPPING_TASK_BASE}/create` && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const result = createMappingTask(ctx.robot, body);
    if (!result.task) {
      sendError(res, 400, result.error ?? 'invalid mapping task create body');
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

  if (url.pathname === `${MAPPING_TASK_BASE}/action` && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const result = applyMappingTaskAction(ctx.robot, body);
    if (result.error) {
      // Fail fast per refactor plan §6.2: missing/unresolvable task_id (or unknown action)
      // surfaces as an explicit error, never a silent no-op.
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

  if (url.pathname === `${MAPPING_TASK_BASE}/list` && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn') ?? ctx.robot.sn;
    const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : DEFAULT_LIMIT;
    const offset = typeof body.offset === 'number' && body.offset >= 0 ? Math.floor(body.offset) : 0;
    sendJson(res, 200, { code: 200, message: '', data: buildMappingTaskListData(ctx.robot, sn, limit, offset) });
    return true;
  }

  return false;
};
