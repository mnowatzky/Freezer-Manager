// Minimal structured logging: one JSON object per line, so `docker compose logs` can be
// filtered/forwarded (e.g. to Loki or GlitchTip) without extra dependencies.
type Level = "info" | "warn" | "error";

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  (level === "error" ? console.error : console.log)(line);
}

export function errorFields(err: unknown) {
  return err instanceof Error ? { error: err.message, stack: err.stack } : { error: String(err) };
}
