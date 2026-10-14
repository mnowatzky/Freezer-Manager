import * as schema from "@freezer/shared/db-schema";
import { schema as zeroSchema } from "@freezer/shared/zero-schema";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";

export const sql = postgres(env.databaseUrl);
export const db = drizzle(sql, { schema });
export const zeroDb = zeroDrizzle(zeroSchema, db);
export { schema };
