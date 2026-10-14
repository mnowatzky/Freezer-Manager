import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL");

// onnotice: silence NOTICEs emitted by zero-cache's DDL event triggers.
const sql = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
await sql.end();
console.log("Migrations applied.");
