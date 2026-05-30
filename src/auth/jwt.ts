import jwt, { type JwtPayload } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

export const JWT_SECRET = process.env.JWT_SECRET || 'mock-map-service-secret-key-2024';
export const TICKET_SECRET = process.env.TICKET_SECRET || 'mock-ticket-secret-2024';

export interface AuthResult {
  readonly valid: boolean;
  readonly payload?: JwtPayload | string;
  readonly error?: string;
  readonly expired?: boolean;
}

export interface TicketResult extends AuthResult {
  readonly consumed?: boolean;
}

const issuedTickets = new Map<string, number>();

function extractBearer(authHeader: string | string[] | undefined): string | null {
  if (Array.isArray(authHeader)) return extractBearer(authHeader[0]);
  if (!authHeader) return null;
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
}

export function generateToken(userId = 'test-user'): string {
  return jwt.sign({ userId, role: 'map_viewer' }, JWT_SECRET, { expiresIn: '24h' });
}

export function verifyJwt(authHeader: string | string[] | undefined): AuthResult {
  const token = extractBearer(authHeader);
  if (!token) return { valid: false, error: 'Missing Authorization header' };
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { valid: true, payload };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
      expired: error instanceof Error && error.name === 'TokenExpiredError',
    };
  }
}

export const verifyToken = verifyJwt;

function cleanupTickets(now = Date.now()): void {
  for (const [ticket, expiresAt] of issuedTickets) {
    if (expiresAt <= now) issuedTickets.delete(ticket);
  }
}

export function generateTicket(jwtPayload: JwtPayload | string | undefined, ttlSec = 120): {
  readonly ticket: string;
  readonly expire_seconds: number;
} {
  const payload = typeof jwtPayload === 'object' && jwtPayload !== null ? jwtPayload : {};
  const ticketId = randomUUID().replace(/-/g, '');
  const userId =
    typeof payload.userId === 'string'
      ? payload.userId
      : typeof payload.sub === 'string'
        ? payload.sub
        : 'mock-user';
  const ticket = jwt.sign({ ticketId, userId, sub: 'ws-access' }, TICKET_SECRET, {
    expiresIn: ttlSec,
  });
  issuedTickets.set(ticket, Date.now() + ttlSec * 1000);
  cleanupTickets();
  return { ticket, expire_seconds: ttlSec };
}

export function verifyTicket(ticket: string | null | undefined, consume = true): TicketResult {
  if (!ticket) return { valid: false, error: 'Missing ticket' };
  cleanupTickets();
  if (!issuedTickets.has(ticket)) {
    return { valid: false, error: 'Unknown or consumed ticket', consumed: true };
  }
  try {
    const payload = jwt.verify(ticket, TICKET_SECRET);
    if (consume) issuedTickets.delete(ticket);
    return { valid: true, payload, consumed: consume };
  } catch (error) {
    issuedTickets.delete(ticket);
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
      expired: error instanceof Error && error.name === 'TokenExpiredError',
    };
  }
}

export function activeTicketCount(): number {
  cleanupTickets();
  return issuedTickets.size;
}
