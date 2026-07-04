import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { parseRobotDomain } from './virtualRobot';
import type { RobotDomain, VirtualRobot, VirtualRobotTranscript } from './virtualRobot';

const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_RECORDING_ROOT = path.join(SERVICE_ROOT, 'recordings');

export interface RecordingEntry {
  readonly ts: number;
  readonly dir: 'in' | 'out' | 'fsm';
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface RecorderSnapshot {
  readonly active: boolean;
  readonly file: string | null;
  readonly entries: number;
  readonly startedAt: string | null;
  readonly recordings: readonly string[];
}

export interface ReplayRequest {
  readonly file?: string;
  readonly inline?: readonly RecordingEntry[];
  readonly preserveTiming?: boolean;
  readonly speed?: number;
}

export interface ReplayResult {
  readonly replayed: number;
  readonly skipped: number;
  readonly file?: string;
}

export class Recorder {
  private activeFile: string | null = null;
  private activeEntries = 0;
  private startedAt: string | null = null;
  private robotListener: ((transcript: VirtualRobotTranscript) => void) | null = null;

  constructor(private readonly recordingRoot = DEFAULT_RECORDING_ROOT) {
    fs.mkdirSync(this.recordingRoot, { recursive: true });
  }

  attachRobot(robot: VirtualRobot): void {
    if (this.robotListener) robot.off('transcript', this.robotListener);
    this.robotListener = transcript => this.recordFsm(transcript);
    robot.on('transcript', this.robotListener);
  }

  start(label?: string): RecorderSnapshot {
    fs.mkdirSync(this.recordingRoot, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = label ? `${sanitizeFileStem(label)}_` : '';
    const filename = `${prefix}${timestamp}.jsonl`;
    this.activeFile = path.join(this.recordingRoot, filename);
    this.activeEntries = 0;
    this.startedAt = new Date().toISOString();
    fs.writeFileSync(this.activeFile, '', 'utf8');
    return this.snapshot();
  }

  stop(): RecorderSnapshot {
    this.activeFile = null;
    this.startedAt = null;
    return this.snapshot();
  }

  snapshot(): RecorderSnapshot {
    return {
      active: this.activeFile !== null,
      file: this.activeFile ? path.basename(this.activeFile) : null,
      entries: this.activeEntries,
      startedAt: this.startedAt,
      recordings: this.listRecordings(),
    };
  }

  listRecordings(): string[] {
    if (!fs.existsSync(this.recordingRoot)) return [];
    return fs.readdirSync(this.recordingRoot)
      .filter(file => file.endsWith('.jsonl'))
      .sort()
      .reverse();
  }

  record(entry: Omit<RecordingEntry, 'ts'> & { readonly ts?: number }): void {
    if (!this.activeFile) return;
    const line = JSON.stringify({ ts: entry.ts ?? Date.now(), ...entry });
    fs.appendFileSync(this.activeFile, `${line}\n`, 'utf8');
    this.activeEntries += 1;
  }

  recordHttp(req: IncomingMessage, pathName: string): void {
    this.record({
      dir: 'in',
      kind: 'http',
      method: req.method ?? 'GET',
      path: pathName,
    });
  }

  recordWsIn(cmd: unknown, data?: unknown): void {
    this.record({ dir: 'in', kind: 'ws', cmd, data });
  }

  recordWsOut(payload: unknown): void {
    if (typeof payload === 'object' && payload !== null) {
      const record = payload as { cmd?: unknown; data?: unknown };
      this.record({ dir: 'out', kind: 'ws', cmd: record.cmd, data: record.data });
      return;
    }
    this.record({ dir: 'out', kind: 'ws', raw: payload });
  }

  recordFsm(transcript: VirtualRobotTranscript): void {
    this.record({
      dir: 'fsm',
      kind: 'transcript',
      domain: transcript.domain,
      event: transcript.event,
      before: transcript.before,
      after: transcript.after,
      changed: transcript.changed,
    });
  }

  readRecording(file: string): RecordingEntry[] {
    const fullPath = this.resolveRecordingPath(file);
    if (!fs.existsSync(fullPath)) throw new Error(`recording not found: ${file}`);
    const lines = fs.readFileSync(fullPath, 'utf8').split('\n').filter(Boolean);
    return lines.map((line, index) => {
      try {
        return JSON.parse(line) as RecordingEntry;
      } catch (error) {
        throw new Error(`invalid recording JSON at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async replay(robot: VirtualRobot, request: ReplayRequest): Promise<ReplayResult> {
    const entries = request.inline ?? (request.file ? this.readRecording(request.file) : null);
    if (!entries) throw new Error('file or inline is required');

    let replayed = 0;
    let skipped = 0;
    let previousTs: number | null = null;
    const speed = typeof request.speed === 'number' && request.speed > 0 ? request.speed : 1;

    for (const entry of entries) {
      if (request.preserveTiming && previousTs !== null) {
        const waitMs = Math.max(0, (entry.ts - previousTs) / speed);
        if (waitMs > 0) await delay(waitMs);
      }
      previousTs = entry.ts;

      if (entry.dir === 'fsm' && entry.kind === 'transcript' && isRecord(entry.event)) {
        robot.dispatchRaw(entry.event as never, parseRobotDomain(entry.domain, 'mapping'));
        replayed += 1;
      } else if (entry.dir === 'fsm' && isRecord(entry.event)) {
        robot.dispatchRaw(entry.event as never, parseRobotDomain(entry.domain, 'mapping'));
        replayed += 1;
      } else {
        skipped += 1;
      }
    }

    return { replayed, skipped, file: request.file };
  }

  private resolveRecordingPath(file: string): string {
    const basename = path.basename(file);
    return path.join(this.recordingRoot, basename);
  }
}

function sanitizeFileStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'recording';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
