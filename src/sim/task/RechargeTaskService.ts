import { createCompactId } from '../../infra/ids';
import { readRechargeNotifySequence } from '../push/rechargeSequence';
import type { RatelNotifyPayload } from '../mappingNotify';
import type { RechargeStatusPush, RechargeTaskRecord } from '../virtualRobotTypes';

type RechargeStatusSink = (payload: RechargeStatusPush) => void;
type RatelStatusSink = (payload: RatelNotifyPayload) => void;

export class RechargeTaskService {
  private task: RechargeTaskRecord | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private readonly emitStatus: RechargeStatusSink,
    private readonly pushRatelStatus: RatelStatusSink,
  ) {}

  active(): RechargeTaskRecord | null {
    return this.task;
  }

  start(sn: string): RechargeTaskRecord {
    this.clearTimers();
    const task: RechargeTaskRecord = {
      task_id: createCompactId('mock-recharge'),
      sn,
      status: 'ON_THE_WAY',
      created_at: Date.now(),
    };
    this.task = task;
    this.emitRechargeStatus();
    this.scheduleReturnDockSequence();
    return task;
  }

  applyAction(action: string): string | null {
    if (!this.task) return 'no active recharge task';
    switch (action) {
      case 'PAUSE':
        this.task.status = 'PAUSE';
        break;
      case 'RESUME':
        this.task.status = 'ON_THE_WAY';
        break;
      case 'CANCEL':
        this.task.status = 'CANCEL';
        this.clearTimers();
        break;
      default:
        return `unknown recharge action ${action}`;
    }
    this.emitRechargeStatus();
    return null;
  }

  clear(): void {
    this.clearTimers();
    this.task = null;
  }

  private emitRechargeStatus(): void {
    if (!this.task) return;
    this.emitStatus({
      sn: this.task.sn,
      task_id: this.task.task_id,
      task_status: this.task.status,
      remark: '',
    });
  }

  private scheduleReturnDockSequence(): void {
    const sequence = readRechargeNotifySequence();
    for (const step of sequence.steps) {
      this.scheduleStep(step.atMs, () => {
        this.pushRatelStatus({ work_status: 'return_dock', sub_status: step.subStatus });
        if (step.subStatus === 'at_dock' && this.task) {
          this.task.status = 'COMPLETE';
          this.emitRechargeStatus();
        }
      });
    }
    this.scheduleStep(sequence.idleDelayMs, () => {
      this.pushRatelStatus({ work_status: 'idle', sub_status: 'none' });
    });
  }

  private scheduleStep(atMs: number, run: () => void): void {
    const handle = setTimeout(() => {
      if (!this.task || this.task.status === 'CANCEL') return;
      run();
    }, atMs);
    (handle as { unref?: () => void }).unref?.();
    this.timers.push(handle);
  }

  private clearTimers(): void {
    for (const handle of this.timers) clearTimeout(handle);
    this.timers = [];
  }
}
