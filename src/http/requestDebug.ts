import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage } from 'node:http';

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const PREVIEW_LENGTH = 2 * 1024;
const rawBodyCache = new WeakMap<IncomingMessage, Promise<string>>();

export interface RequestDebugContext {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string | string[]>;
  readonly echoEnabled: boolean;
  requestPayload: unknown;
}

const requestDebugStorage = new AsyncLocalStorage<RequestDebugContext>();

export function runWithRequestDebug<T>(
  context: RequestDebugContext,
  callback: () => T,
): T {
  return requestDebugStorage.run(context, callback);
}

export function currentRequestDebug(): RequestDebugContext | undefined {
  return requestDebugStorage.getStore();
}

export function requestEchoEnabled(req: IncomingMessage): boolean {
  if (process.env.MOCK_ECHO_REQUEST_PAYLOAD === '1') return true;
  const value = req.headers['x-mock-debug-echo'];
  return value === '1' || value === 'true' || (Array.isArray(value) && value.some(item => item === '1' || item === 'true'));
}

export function isBusinessRequest(pathname: string): boolean {
  return pathname !== '/api/health' && !pathname.startsWith('/sim/');
}

export async function captureRequestPayload(req: IncomingMessage): Promise<unknown> {
  if (!requestMayHaveBody(req)) return null;
  const raw = (await readRawBody(req)).trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export async function readRawBody(req: IncomingMessage): Promise<string> {
  let pending = rawBodyCache.get(req);
  if (!pending) {
    pending = consumeRawBody(req);
    rawBodyCache.set(req, pending);
  }
  return pending;
}

export function sanitizeDebugPayload(value: unknown): unknown {
  const redacted = redactSensitiveValues(value);
  const serialized = safeStringify(redacted);
  const byteLength = Buffer.byteLength(serialized);
  const maxBytes = debugPayloadMaxBytes();
  if (byteLength <= maxBytes) return redacted;
  return {
    _truncated: true,
    byteLength,
    maxBytes,
    preview: serialized.slice(0, PREVIEW_LENGTH),
  };
}

export function queryRecord(searchParams: URLSearchParams): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams) {
    const previous = result[key];
    if (previous === undefined) result[key] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else result[key] = [previous, value];
  }
  return result;
}

function requestMayHaveBody(req: IncomingMessage): boolean {
  const method = req.method?.toUpperCase() ?? 'GET';
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

async function consumeRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (!isRecord(value)) {
    return typeof value === 'string' ? redactBearerTokens(value) : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    isSensitiveKey(key) ? '[REDACTED]' : redactSensitiveValues(child),
  ]));
}

function isSensitiveKey(key: string): boolean {
  return /authorization|cookie|password|passwd|secret|token|ticket|credential|api[_-]?key|access[_-]?key/i.test(key);
}

function redactBearerTokens(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]');
}

function debugPayloadMaxBytes(): number {
  const configured = Number.parseInt(process.env.MOCK_DEBUG_PAYLOAD_MAX_BYTES ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_PAYLOAD_BYTES;
}

function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
