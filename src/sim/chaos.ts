export interface ChaosConfig {
  readonly latencyMs?: number;
  readonly dropRate?: number;
  readonly reorderWindowMs?: number;
}

export class ChaosController {
  private config: Required<ChaosConfig> = { latencyMs: 0, dropRate: 0, reorderWindowMs: 0 };

  update(next: ChaosConfig): Required<ChaosConfig> {
    this.config = {
      latencyMs: Math.max(0, Math.trunc(next.latencyMs ?? this.config.latencyMs)),
      dropRate: Math.min(1, Math.max(0, Number(next.dropRate ?? this.config.dropRate))),
      reorderWindowMs: Math.max(0, Math.trunc(next.reorderWindowMs ?? this.config.reorderWindowMs)),
    };
    return this.config;
  }

  snapshot(): Required<ChaosConfig> {
    return this.config;
  }

  send(sendNow: () => void): void {
    if (this.config.dropRate > 0 && Math.random() < this.config.dropRate) return;
    const jitter = this.config.reorderWindowMs > 0
      ? Math.floor(Math.random() * this.config.reorderWindowMs)
      : 0;
    const delay = this.config.latencyMs + jitter;
    if (delay <= 0) sendNow();
    else setTimeout(sendNow, delay);
  }
}
