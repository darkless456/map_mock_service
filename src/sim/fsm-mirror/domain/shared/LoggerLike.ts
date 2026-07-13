/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/shared/LoggerLike.ts. DO NOT EDIT. !!!
// Source SHA-256: 9eb4d2d4aee3996b649893ad05cc68792b3e88c016a72419b4b84d9923772fe8
// Synced at: 2026-07-13T09:08:25.761Z
/**
 * LoggerLike — the minimal logger contract that the domain layer accepts as
 * a dependency injection. We do NOT depend on `services/log` so the domain
 * stays free of React-Native / platform code and can run in plain Node tests.
 *
 * The shape mirrors the common subset of pino / winston / console: levelled
 * methods that accept a category, a message and an optional structured
 * payload. Adapter layers map this to the concrete logger.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogPayload = Record<string, unknown>;

export interface LoggerLike {
  debug(category: string, message: string, payload?: LogPayload): void;
  info(category: string, message: string, payload?: LogPayload): void;
  warn(category: string, message: string, payload?: LogPayload): void;
  error(category: string, message: string, payload?: LogPayload): void;
}

/** A logger that drops every call. Safe default when no logger is injected. */
export const noopLogger: LoggerLike = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Helper used internally by domain reducers: log only when a logger is
 * provided, and never throw on logger failures (defensive against test fakes).
 */
export function safeLog(
  logger: LoggerLike | undefined,
  level: LogLevel,
  category: string,
  message: string,
  payload?: LogPayload,
): void {
  if (!logger) return;
  try {
    logger[level](category, message, payload);
  } catch {
    /* swallow — logging must never break the domain transition */
  }
}
