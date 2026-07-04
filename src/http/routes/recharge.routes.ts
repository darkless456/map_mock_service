import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendJson, stringBodyField } from '../shared/http';
import type { AppRouteContext } from '../router';

/**
 * 回充（回桩）HTTP 端点（docs §12 / §13）：
 * - `POST /robot/recharge/task` → 触发回充，返回 `task_id`，并启动回桩 NOTIFY 序列
 *   （`return_dock` 逐步 sub_status → `idle`）+ WS `RECHARGE` 推送。
 * - `POST /robot/recharge/action`（PAUSE / RESUME / CANCEL）→ 更新回充任务状态。
 */
const RECHARGE_BASE = '/ratel/api/v1/robot/recharge';

export const handleRechargeRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (url.pathname === `${RECHARGE_BASE}/task` && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const sn = stringBodyField(body, 'sn') ?? ctx.robot.sn;
    const task = ctx.robot.startRecharge(sn);
    sendJson(res, 200, {
      code: 200,
      message: '',
      data: { task_id: task.task_id, robot_code: 0, robot_message: 'ok' },
    });
    return true;
  }

  if (url.pathname === `${RECHARGE_BASE}/action` && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const action = stringBodyField(body, 'action') ?? '';
    const error = ctx.robot.applyRechargeAction(action);
    if (error) {
      sendJson(res, 200, {
        code: 400,
        message: error,
        data: { robot_code: -1, robot_message: error },
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

  return false;
};
