export interface Logger {
  debug(msg: string): void
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export function createLogger(prefix = "wx-clawbot-notifier"): Logger {
  const fmt = (level: string, msg: string) => `[${prefix}] [${level}] ${msg}`
  return {
    debug: (msg) => console.debug(fmt("debug", msg)),
    info: (msg) => console.log(fmt("info", msg)),
    warn: (msg) => console.warn(fmt("warn", msg)),
    error: (msg) => console.error(fmt("error", msg)),
  }
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}
