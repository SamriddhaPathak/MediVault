// Minimal structured logger. Deliberately never logs raw file contents,
// extracted medical text, or full request bodies — only event metadata.
type Level = "info" | "warn" | "error";

function log(level: Level, message: string, meta?: Record<string, unknown>) {
  const entry = { level, message, ts: new Date().toISOString(), ...meta };
  // eslint-disable-next-line no-console
  console[level === "info" ? "log" : level](JSON.stringify(entry));
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};
