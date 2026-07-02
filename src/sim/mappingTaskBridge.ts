import type { VirtualRobot, MappingTaskRecord } from './virtualRobot';

const VALID_ACTIONS = new Set(['PAUSE', 'RESUME', 'STOP']);

export function createMappingTask(
  robot: VirtualRobot,
  body: Record<string, unknown>,
): { task?: MappingTaskRecord; error?: string } {
  const sn = typeof body.sn === 'string' ? body.sn.trim() : '';
  if (!sn) return { error: 'sn is required' };
  const mapId = typeof body.map_id === 'string' ? body.map_id.trim() : '';
  if (!mapId) return { error: 'map_id is required' };
  const mode = typeof body.mode === 'string' ? body.mode.trim() : '';
  if (!mode) return { error: 'mode is required' };
  return { task: robot.createMappingTask({ sn, map_id: mapId, mode }) };
}

export function applyMappingTaskAction(
  robot: VirtualRobot,
  body: Record<string, unknown>,
): { error?: string } {
  const sn = typeof body.sn === 'string' ? body.sn.trim() : '';
  if (!sn) return { error: 'sn is required' };
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!VALID_ACTIONS.has(action)) return { error: 'action must be one of PAUSE|RESUME|STOP' };
  // task_id is optional per API doc — server falls back to the latest active task for `sn`.
  // Falling back silently to "no task_id" addressing is explicitly disallowed by the
  // refactor plan §6.2: if neither `task_id` nor an active task-by-sn can be resolved,
  // `applyMappingTaskAction` below returns an error string, which we surface as-is.
  const taskId = typeof body.task_id === 'string' && body.task_id.trim() ? body.task_id.trim() : undefined;
  const payload = typeof body.payload === 'object' && body.payload !== null && !Array.isArray(body.payload)
    ? body.payload as Record<string, unknown>
    : undefined;
  const save = payload?.save === true || payload?.save === 1 || payload?.save === '1';
  const err = robot.applyMappingTaskAction({ sn, taskId, action, save });
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
