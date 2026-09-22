-- Momentum Todo — Migration 0003: Stage 6 AI Usage Limiting
-- Dedicated table for tracking daily per-user AI request allowance

CREATE TABLE IF NOT EXISTS "ai_daily_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "usage_date" date NOT NULL,
  "request_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_ai_daily_usage_user_date" UNIQUE ("user_id", "usage_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_daily_usage_user_date" ON "ai_daily_usage" ("user_id", "usage_date");
