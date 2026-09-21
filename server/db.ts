import { neon, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import * as dotenv from "dotenv";
import * as schema from "./schema.js";

dotenv.config({ override: true });

// 1. HTTP-based lightweight client for fast, stateless serverless read/write queries
export function getDbHttp() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is missing.");
  }
  const sql = neon(connectionString);
  return drizzle(sql, { schema });
}

// 2. Pool-based client for ACID multi-statement transactions (e.g. migration import & atomic recurrence)
let pool: Pool | null = null;

export function getDbPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is missing.");
  }
  if (!pool) {
    pool = new Pool({ connectionString });
  }
  return drizzleServerless(pool, { schema });
}

export { schema };
