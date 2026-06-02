import type { LoggerLike } from '../../domain/shared/LoggerLike';

const noopLogger: LoggerLike = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Stand-in for mower `getModuleLogger` in the FSM mirror. */
export function getModuleLogger(): LoggerLike {
  return noopLogger;
}
