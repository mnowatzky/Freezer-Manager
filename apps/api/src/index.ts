import { serve } from "@hono/node-server";
import { app } from "./app";
import { sql } from "./db";
import { env } from "./env";

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

// Graceful shutdown (docker stop sends SIGTERM): stop accepting connections, let in-flight
// requests finish, close the database pool. Force-exit if that takes longer than 10 s.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down…`);
  setTimeout(() => {
    console.error("Shutdown timed out, exiting.");
    process.exit(1);
  }, 10_000).unref();
  server.close(async (err) => {
    await sql.end({ timeout: 5 });
    process.exit(err ? 1 : 0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
