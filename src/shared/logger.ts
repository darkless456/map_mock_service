export interface Logger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  debug(message: string, extra?: Record<string, unknown>): void;
}

function log(level: keyof Console, message: string, extra?: Record<string, unknown>): void {
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  const fn = typeof console[level] === 'function' ? console[level] : console.log;
  (fn as (...args: unknown[]) => void)(`[sim] ${message}${payload}`);
}

export const logger: Logger = {
  info: (message, extra) => log('log', message, extra),
  warn: (message, extra) => log('warn', message, extra),
  error: (message, extra) => log('error', message, extra),
  debug: (message, extra) => {
    if (process.env.DEBUG_SIM === '1') log('debug', message, extra);
  },
};
