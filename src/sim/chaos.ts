export interface ChaosConfig {
  readonly latencyMs?: number;
  readonly dropRate?: number;
  readonly reorderWindowMs?: number;
}

export interface RealismConfig {
  readonly enabled?: boolean;
  readonly httpDelayMinMs?: number;
  readonly httpDelayMaxMs?: number;
  readonly wsDelayMinMs?: number;
  readonly wsDelayMaxMs?: number;
}

export type RequiredRealismConfig = Required<RealismConfig>;

const DEFAULT_REALISM: RequiredRealismConfig = {
  enabled: false,
  httpDelayMinMs: 500,
  httpDelayMaxMs: 3000,
  wsDelayMinMs: 2000,
  wsDelayMaxMs: 8000,
};

export class ChaosController {
  private config: Required<ChaosConfig> = { latencyMs: 0, dropRate: 0, reorderWindowMs: 0 };
  private realism: RequiredRealismConfig = { ...DEFAULT_REALISM };

  constructor(realism?: RealismConfig) {
    const envEnabled = process.env.SIM_REALISM === '1' || process.env.SIM_REALISM === 'true';
    this.updateRealism({ ...realism, enabled: realism?.enabled ?? envEnabled });
  }

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

  updateRealism(next: RealismConfig): RequiredRealismConfig {
    const httpMin = positiveInt(next.httpDelayMinMs ?? this.realism.httpDelayMinMs);
    const httpMax = positiveInt(next.httpDelayMaxMs ?? this.realism.httpDelayMaxMs);
    const wsMin = positiveInt(next.wsDelayMinMs ?? this.realism.wsDelayMinMs);
    const wsMax = positiveInt(next.wsDelayMaxMs ?? this.realism.wsDelayMaxMs);
    this.realism = {
      enabled: next.enabled ?? this.realism.enabled,
      httpDelayMinMs: Math.min(httpMin, httpMax),
      httpDelayMaxMs: Math.max(httpMin, httpMax),
      wsDelayMinMs: Math.min(wsMin, wsMax),
      wsDelayMaxMs: Math.max(wsMin, wsMax),
    };
    return this.realism;
  }

  realismSnapshot(): RequiredRealismConfig {
    return this.realism;
  }

  httpDelayMs(): number {
    if (!this.realism.enabled) return 0;
    return randBetween(this.realism.httpDelayMinMs, this.realism.httpDelayMaxMs);
  }

  wsDelayMs(): number {
    if (!this.realism.enabled) return 0;
    return randBetween(this.realism.wsDelayMinMs, this.realism.wsDelayMaxMs);
  }

  send(sendNow: () => void): void {
    if (this.config.dropRate > 0 && Math.random() < this.config.dropRate) return;
    const jitter = this.config.reorderWindowMs > 0
      ? Math.floor(Math.random() * this.config.reorderWindowMs)
      : 0;
    const delay = this.config.latencyMs + jitter + this.wsDelayMs();
    if (delay <= 0) sendNow();
    else setTimeout(sendNow, delay);
  }
}

function positiveInt(value: number): number {
  return Math.max(0, Math.trunc(value));
}

function randBetween(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}
