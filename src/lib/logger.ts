/**
 * Tiny structured logger. Works on both server and browser.
 * Every line is one JSON-ish string so it's easy to grep.
 *
 * Usage:
 *   const log = createLogger("invoices.extract");
 *   log.info("started", { invoiceId });
 *   log.error("failed", { err });
 */

type Level = "debug" | "info" | "warn" | "error";

const isServer = typeof window === "undefined";
const env = isServer ? "server" : "client";

function fmt(scope: string, level: Level, msg: string, meta?: Record<string, unknown>) {
  const time = new Date().toISOString();
  const base = `[${time}] [${env}] [${level.toUpperCase()}] [${scope}] ${msg}`;
  if (!meta) return base;
  try {
    return `${base} ${JSON.stringify(meta, replacer)}`;
  } catch {
    return `${base} <unserializable-meta>`;
  }
}

function replacer(_key: string, value: unknown) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export function createLogger(scope: string) {
  return {
    debug(msg: string, meta?: Record<string, unknown>) {
      console.debug(fmt(scope, "debug", msg, meta));
    },
    info(msg: string, meta?: Record<string, unknown>) {
      console.info(fmt(scope, "info", msg, meta));
    },
    warn(msg: string, meta?: Record<string, unknown>) {
      console.warn(fmt(scope, "warn", msg, meta));
    },
    error(msg: string, meta?: Record<string, unknown>) {
      console.error(fmt(scope, "error", msg, meta));
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
