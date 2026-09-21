import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config({ override: true });

export default defineConfig({
  schema: "./server/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
  verbose: true,
  strict: true,
});
