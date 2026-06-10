import type { VirtualRobot, MowingTaskRecord } from './virtualRobot';

export function createMowingTask(
  robot: VirtualRobot,
  body: Record<string, unknown>,
): { task?: MowingTaskRecord; error?: string } {
  const sn = typeof body.sn === 'string' ? body.sn.trim() : '';
  if (!sn) return { error: 'sn is required' };
  const taskInfo = body.task_info;
  if (typeof taskInfo !== 'object' || taskInfo === null || Array.isArray(taskInfo)) {
    return { error: 'task_info is required' };
  }
  return { task: robot.createMowingTask({ sn, task_info: taskInfo as Record<string, unknown> }) };
}

export function applyTaskAction(
  robot: VirtualRobot,
  body: Record<string, unknown>,
): { error?: string } {
  const taskId = typeof body.task_id === 'string' ? body.task_id : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!taskId || !action) return { error: 'task_id and action are required' };
  const err = robot.applyMowingAction(taskId, action);
  return err ? { error: err } : {};
}

function taskNotifyOf(task: MowingTaskRecord): Record<string, unknown> {
  return {
    task_id: task.task_id,
    task_status: task.status,
    task_type: task.task_type,
    task_message: task.task_message,
    task_error_code: task.task_error_code,
    mow_area: task.mow_area,
    mow_progress: task.mow_progress,
    estimated_time: task.estimated_time,
  };
}

export function buildTaskListData(robot: VirtualRobot, sn?: string): Record<string, unknown> {
  const tasks = robot.listTasks(sn);
  const active = tasks.find(task => task.status === 'ON_THE_WAY' || task.status === 'PAUSE') ?? null;
  const createTimeSec = (task: MowingTaskRecord) => Math.floor(task.created_at / 1000);
  return {
    total: tasks.length,
    list: tasks.map(task => ({
      task_id: task.task_id,
      task_status: task.status,
      task_info: task.task_info,
      task_notify: taskNotifyOf(task),
      create_time: createTimeSec(task),
      update_time: createTimeSec(task),
    })),
    task_info: active?.task_info ?? null,
    task_notify: active ? taskNotifyOf(active) : null,
  };
}
