import { createCompactId } from '../../infra/ids';
import type { MappingContext } from '../fsm-mirror/domain/mapping/MappingSession';
import type { MappingTaskRecord } from '../virtualRobotTypes';

export class MappingTaskService {
  private readonly tasks = new Map<string, MappingTaskRecord>();
  private readonly latestBySn = new Map<string, string>();

  clear(): void {
    this.tasks.clear();
    this.latestBySn.clear();
  }

  create(sn: string, mapId: string, mode: string): MappingTaskRecord {
    const now = Date.now();
    const task: MappingTaskRecord = {
      task_id: createCompactId('mock-mapping-task'),
      sn,
      status: 'ON_THE_WAY',
      map_id: mapId,
      mode,
      task_message: '',
      task_error_code: 0,
      created_at: now,
      updated_at: now,
    };
    this.tasks.set(task.task_id, task);
    this.latestBySn.set(sn, task.task_id);
    return task;
  }

  list(sn?: string): MappingTaskRecord[] {
    return [...this.tasks.values()]
      .filter(task => !sn || task.sn === sn)
      .sort((a, b) => b.created_at - a.created_at);
  }

  active(sn: string): MappingTaskRecord | null {
    const taskId = this.latestBySn.get(sn);
    return taskId ? this.tasks.get(taskId) ?? null : null;
  }

  resolve(sn: string, taskId?: string): MappingTaskRecord | undefined {
    if (taskId) return this.tasks.get(taskId);
    const latest = this.latestBySn.get(sn);
    return latest ? this.tasks.get(latest) : undefined;
  }

  latestBySnObject(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.latestBySn);
  }

  syncFromContext(sn: string, mapping: MappingContext): void {
    const task = this.active(sn);
    if (!task) return;
    const before = task.status;
    switch (mapping.state) {
      case 'WORKING':
      case 'RESUMING':
      case 'PREPARING':
      case 'UNDOCKING':
      case 'REMOTE_CONTROL':
        task.status = 'ON_THE_WAY';
        task.task_message = '';
        break;
      case 'PAUSED':
        task.status = 'PAUSE';
        task.task_message = 'Paused by user';
        break;
      case 'COMPLETED':
        task.status = 'COMPLETE';
        task.task_message = task.task_message || 'Mapping complete';
        break;
      case 'CANCELLED':
        task.status = 'CANCEL';
        task.task_message = 'Cancelled by user';
        break;
      case 'ERRORED':
        task.status = 'FAILED';
        task.task_message = mapping.error?.code ?? 'Mapping failed';
        task.task_error_code = -1;
        break;
      default:
        break;
    }
    if (task.status !== before) task.updated_at = Date.now();
  }
}
