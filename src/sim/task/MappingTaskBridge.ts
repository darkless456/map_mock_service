import type { MappingActionDeps, MappingActionError, VirtualRobot, MappingTaskRecord } from '../virtualRobot';

// mapping-v4-final-spec.md §1: full VALID_ACTIONS set (all 7 batches landed).
//
// 「结束建图」的权威 action 名是 **`EXPAND_AREA_FINISH`**（2026-08-21 确认），
// 与 App 端接口文档 §建图任务Action 和 mower 的 `MappingTaskAction` 一致。
// 此前这里写的是 `COMPLETE`（spec 早期的猜测名），而 mower 一直发 `EXPAND_AREA_FINISH`
// ——两边对不上，Mock 会以 400 bad_request 挡掉真实 App 的「完成」请求，
// 建图完成之后的整段流程在 Mock 上根本走不通。**不保留 `COMPLETE` 别名**：
// 留着只会让下一个人以为两个名字都合法。
//
// 同一类问题还有一处：「停止建图」的权威名是 **`CANCEL`**，此前写的是 `STOP`
// （同样是 spec 早期猜测名），会挡掉 App 的「退出建图」。两处均以
// `APP端接口文档 §建图任务Action` 的枚举为准：
// PAUSE / RESUME / CANCEL / EDGE_START / EDGE_CLOSE / EXPAND_AREA / EXPAND_AREA_FINISH。
const VALID_ACTIONS = new Set([
  'PAUSE', 'RESUME', 'CANCEL', 'EDGE_START', 'EDGE_CLOSE', 'EXPAND_AREA_FINISH', 'EXPAND_AREA',
  // 上传失败后的「重传地图」（设备端 2026-08-24 定稿），与 mower 的 `MappingTaskAction` 同步。
  'RETRANSMIT_MAP',
]);

/**
 * `mode` 取值：`auto` / `manual` / `follow` / `extend`。`extend`（v9 新增，地图编辑页
 * 「添加草坪」）在既有地图上扩展建图，由 robot 侧走独立分支，但同样返回 task_id，
 * 因此这里无需为它分叉响应结构——只把设备侧的错误类型透出去给路由映射 HTTP 状态。
 */
export function createMappingTask(
  robot: VirtualRobot,
  body: Record<string, unknown>,
  deps?: MappingActionDeps,
): { task?: MappingTaskRecord; error?: string; errorKind?: MappingActionError['kind'] } {
  const sn = typeof body.sn === 'string' ? body.sn.trim() : '';
  if (!sn) return { error: 'sn is required' };
  const mapId = typeof body.map_id === 'string' ? body.map_id.trim() : '';
  if (!mapId) return { error: 'map_id is required' };
  const mode = typeof body.mode === 'string' ? body.mode.trim() : '';
  if (!mode) return { error: 'mode is required' };
  const result = robot.createMappingTask({ sn, map_id: mapId, mode }, deps);
  if (result.error) return { error: result.error.message, errorKind: result.error.kind };
  return { task: result.task };
}

export function applyMappingTaskAction(
  robot: VirtualRobot,
  body: Record<string, unknown>,
  deps?: MappingActionDeps,
): { error?: MappingActionError } {
  const sn = typeof body.sn === 'string' ? body.sn.trim() : '';
  if (!sn) return { error: { kind: 'bad_request', message: 'sn is required' } };
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!VALID_ACTIONS.has(action)) {
    return {
      error: {
        kind: 'bad_request',
        message:
          'action must be one of PAUSE|RESUME|CANCEL|EDGE_START|EDGE_CLOSE|EXPAND_AREA_FINISH|EXPAND_AREA|RETRANSMIT_MAP',
      },
    };
  }
  // task_id is optional per API doc; robot.applyMappingTaskAction fail-fasts if
  // neither task_id nor the latest active task for sn can be resolved.
  const taskId = typeof body.task_id === 'string' && body.task_id.trim() ? body.task_id.trim() : undefined;
  const payload = typeof body.payload === 'object' && body.payload !== null && !Array.isArray(body.payload)
    ? body.payload as Record<string, unknown>
    : undefined;
  const save = payload?.save === true || payload?.save === 1 || payload?.save === '1';
  const err = robot.applyMappingTaskAction({ sn, taskId, action, save }, deps);
  return err ? { error: err } : {};
}

function taskInfoOf(task: MappingTaskRecord): Record<string, unknown> {
  return { map_id: task.map_id, mode: task.mode };
}

function taskNotifyOf(task: MappingTaskRecord): Record<string, unknown> {
  return {
    map_id: task.map_id,
    task_message: task.task_message,
    task_error_code: task.task_error_code,
  };
}

export function buildMappingTaskListData(
  robot: VirtualRobot,
  sn: string,
  limit: number,
  offset = 0,
): Record<string, unknown> {
  const all = robot.listMappingTasks(sn);
  const sliced = all.slice(offset, offset + limit);
  const toSec = (ms: number) => Math.floor(ms / 1000);
  return {
    total: all.length,
    list: sliced.map(task => ({
      task_id: task.task_id,
      task_status: task.status,
      task_info: taskInfoOf(task),
      task_notify: taskNotifyOf(task),
      create_time: toSec(task.created_at),
      update_time: toSec(task.updated_at),
    })),
  };
}
