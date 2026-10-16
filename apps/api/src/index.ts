import { serve } from "@hono/node-server";
import { app } from "./app";
import { sql } from "./db";
import { env } from "./env";
import { log } from "./log";

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  log("info", "API listening", { port: info.port });
});

// Graceful shutdown (docker stop sends SIGTERM): stop accepting connections, let in-flight
// requests finish, close the database pool. Force-exit if that takes longer than 10 s.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log("info", "shutting down", { signal });
  setTimeout(() => {
    log("error", "shutdown timed out, exiting");
    process.exit(1);
  }, 10_000).unref();
  server.close((err) => {
    void sql.end({ timeout: 5 }).finally(() => process.exit(err ? 1 : 0));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
