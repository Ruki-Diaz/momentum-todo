-- Momentum Todo — Migration 0004: "Your day" morning email preferences
-- Opt-in flag plus the preferred local hour (0–23) for the morning email.

ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "daily_email" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "daily_email_hour" integer DEFAULT 8 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_settings" ADD CONSTRAINT "chk_user_settings_daily_email_hour" CHECK ("daily_email_hour" BETWEEN 0 AND 23);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
