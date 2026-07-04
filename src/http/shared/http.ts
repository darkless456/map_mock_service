import type { IncomingMessage, ServerResponse } from 'node:http';

export type JsonRecord = Record<string, unknown>;

export interface HttpRouteContext {
  readonly port: number;
}

export interface HttpRouteDeps extends HttpRouteContext {
  readonly [key: string]: unknown;
}

export type RouteHandler<TContext extends HttpRouteDeps> = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: TContext,
) => Promise<boolean> | boolean;

export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, platform, X-Device, X-Device-Id, X-Device-Version',
  );
}

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

export function sendOk<T>(res: ServerResponse, data: T, message = 'Success'): void {
  sendJson(res, 200, { code: 200, message, data });
}

export function sendError(
  res: ServerResponse,
  statusCode: number,
  message: string,
  code = statusCode,
  extra: JsonRecord = {},
): void {
  sendJson(res, statusCode, { code, message, ...extra });
}

export async function readJsonBody<T extends JsonRecord = JsonRecord>(
  req: IncomingMessage,
): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object');
  }
  return parsed as T;
}

export function methodIs(req: IncomingMessage, ...methods: string[]): boolean {
  const method = req.method?.toUpperCase() ?? '';
  return methods.includes(method);
}

export function stringBodyField(body: JsonRecord, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function numberBodyField(body: JsonRecord, key: string): number | null {
  const value = body[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hostBaseUrl(req: IncomingMessage, fallbackPort: number): string {
  const host = req.headers.host || `localhost:${fallbackPort}`;
  return `http://${host}`;
}
