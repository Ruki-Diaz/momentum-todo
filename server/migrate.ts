import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { getDbPool } from "./db.js";
import * as dotenv from "dotenv";

dotenv.config({ override: true });

async function runMigrations() {
  console.log("▶ Applying database migrations to Neon PostgreSQL...");

  if (!process.env.DATABASE_URL) {
    console.error("❌ ERROR: DATABASE_URL is not set in environment variables.");
    process.exit(1);
  }

  try {
    const db = getDbPool();
    await migrate(db, { migrationsFolder: "./migrations" });
    console.log("✅ Database migrations applied successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

runMigrations();
