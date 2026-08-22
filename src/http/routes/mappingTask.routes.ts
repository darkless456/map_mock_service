import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendError, sendJson, stringBodyField } from '../shared/http';
import { createDatasetSwitcher } from '../../sim/mapStream';
import { applyMappingTaskAction, buildMappingTaskListData, createMappingTask } from '../../sim/task/MappingTaskBridge';
import type { AppRouteContext } from '../router';
import { MAPPING_ERROR_STATUS } from './mappingErrors';

const MAPPING_TASK_BASE = '/ratel/central-control-service/api/v1/ratel_mapping_task';
// 与割草任务列表一致的坑点：后端 limit 缺省为 0 会返回空列表，mock 侧同样要求显式默认值。
const DEFAULT_LIMIT = 10;

export const handleMappingTaskRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (url.pathname === `${MAPPING_TASK_BASE}/create` && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    // `mode:'extend'`（地图编辑页「添加草坪」）需要切数据集，与 EXPAND_AREA 同一条依赖。
    const result = createMappingTask(ctx.robot, body, { switchDataset: createDatasetSwitcher(ctx.mapStream) });
    if (!result.task) {
      // 设备侧拒绝（忙 / sn 未绑定 / 草坪数超限）按 kind 映射 409/404/422，
      // 参数缺失仍是 400；扩展建图的失败必须能被 App 区分，不能一律拍平成 400。
      const status = result.errorKind ? MAPPING_ERROR_STATUS[result.errorKind] : 400;
      sendError(res, status, result.error ?? 'invalid mapping task create body', status, {
        data: { robot_code: -1, robot_message: result.error ?? 'invalid mapping task create body' },
      });
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
    // EXPAND_AREA (mapping-v4-final-spec.md §7) needs to drive `ctx.mapStream`; wired the same
    // way `applyFault` gets its `switchDataset` closure in server.ts.
    const result = applyMappingTaskAction(ctx.robot, body, { switchDataset: createDatasetSwitcher(ctx.mapStream) });
    if (result.error) {
      // Fail fast per refactor plan §6.2 + mapping-v4-final-spec.md §0 #14: missing/
      // unresolvable task_id, wrong phase, or an unsigned legitimacy flag all surface as an
      // explicit HTTP status (400/404/409/422), never a silent no-op or a flattened 200.
      const status = MAPPING_ERROR_STATUS[result.error.kind];
      sendError(res, status, result.error.message, status, { data: { robot_code: -1, robot_message: result.error.message } });
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
