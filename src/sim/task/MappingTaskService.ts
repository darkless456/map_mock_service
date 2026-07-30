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

  /**
   * mapping_snapshot_recovery_design.md §19.5 item 3: force the active task into a
   * terminal state (COMPLETE/CANCEL/FAILED) for recovery tests, and optionally backdate
   * `updated_at` by `ageMs` so the app-side 120 s completion countdown / terminal-notice
   * window can be crossed deterministically. Creates a task if `sn` has none.
   */
  forceStatus(
    sn: string,
    status: MappingTaskRecord['status'],
    opts: { ageMs?: number; mapId?: string; mode?: string; message?: string; errorCode?: number } = {},
  ): MappingTaskRecord {
    const task = this.active(sn) ?? this.create(sn, opts.mapId ?? 'mock_map_001', opts.mode ?? 'auto');
    task.status = status;
    if (typeof opts.message === 'string') task.task_message = opts.message;
    if (typeof opts.errorCode === 'number') task.task_error_code = opts.errorCode;
    const ageMs = typeof opts.ageMs === 'number' && opts.ageMs > 0 ? opts.ageMs : 0;
    task.updated_at = Date.now() - ageMs;
    return task;
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
