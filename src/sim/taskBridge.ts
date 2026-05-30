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

export function buildTaskListData(robot: VirtualRobot, sn?: string): Record<string, unknown> {
  const tasks = robot.listTasks(sn);
  const active = tasks.find(task => task.status === 'ON_THE_WAY' || task.status === 'PAUSE') ?? null;
  return {
    total: tasks.length,
    list: tasks.map(task => ({ task_id: task.task_id, task_status: task.status })),
    task_info: active?.task_info ?? null,
    task_notify: active
      ? {
          task_type: active.task_type,
          task_message: active.task_message,
          task_error_code: active.task_error_code,
          mow_area: active.mow_area,
          mow_progress: active.mow_progress,
          estimated_time: active.estimated_time,
        }
      : null,
  };
}
