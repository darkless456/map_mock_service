import { createCompactId } from '../../infra/ids';
import type { MowingContext, MowingEvent } from '../fsm-mirror/domain/mowing/MowingTask';
import type { SimOnlyEvent } from '../simFsmTypes';
import type { MowingTaskRecord } from '../virtualRobotTypes';

export class MowingTaskService {
  private readonly tasks = new Map<string, MowingTaskRecord>();
  private readonly latestBySn = new Map<string, string>();

  clear(): void {
    this.tasks.clear();
    this.latestBySn.clear();
  }

  create(sn: string, taskInfo: Record<string, unknown>): MowingTaskRecord {
    const task: MowingTaskRecord = {
      task_id: createCompactId('mock-task'),
      sn,
      status: 'ON_THE_WAY',
      task_type: 'cloud',
      task_message: '',
      task_error_code: 0,
      mow_area: 0,
      mow_progress: 0,
      estimated_time: 300,
      task_info: taskInfo,
      created_at: Date.now(),
    };
    this.tasks.set(task.task_id, task);
    this.latestBySn.set(sn, task.task_id);
    return task;
  }

  list(sn?: string): MowingTaskRecord[] {
    return [...this.tasks.values()]
      .filter(task => !sn || task.sn === sn)
      .sort((a, b) => b.created_at - a.created_at);
  }

  active(sn: string): MowingTaskRecord | null {
    const taskId = this.latestBySn.get(sn);
    return taskId ? this.tasks.get(taskId) ?? null : null;
  }

  get(taskId: string): MowingTaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  ensureScenarioTask(sn: string, event: MowingEvent | SimOnlyEvent): void {
    if (event.type !== 'CMD_START' || this.active(sn)) return;
    const taskMode = 'taskMode' in event && typeof event.taskMode === 'string'
      ? event.taskMode
      : 'MOW_GLOBAL';
    this.create(sn, {
      map_id: 'mock_map_001',
      task_mode: taskMode === 'MOW_REGION' ? 'area' : taskMode === 'MOW_EDGE' ? 'edge' : 'global',
      source: 'scenario',
    });
  }

  syncFromContext(sn: string, mowing: MowingContext): void {
    const task = this.active(sn);
    if (!task) return;
    switch (mowing.state) {
      case 'WORKING':
      case 'RESUMING':
      case 'PREPARING':
      case 'UNDOCKING':
        task.status = 'ON_THE_WAY';
        task.task_message = '';
        break;
      case 'PAUSED':
      case 'REMOTE_CONTROL':
        task.status = 'PAUSE';
        task.task_message = 'Paused by user';
        break;
      case 'COMPLETED':
        task.status = 'COMPLETE';
        task.task_message = task.task_message || 'Mowing complete';
        task.mow_progress = Math.max(task.mow_progress, 100);
        task.estimated_time = 0;
        break;
      case 'CANCELLED':
        task.status = 'CANCEL';
        task.task_message = 'Cancelled by user';
        break;
      case 'ERRORED':
        task.status = 'FAILED';
        task.task_message = mowing.error?.code ?? 'Mowing failed';
        task.task_error_code = -1;
        break;
      default:
        break;
    }
  }
}
