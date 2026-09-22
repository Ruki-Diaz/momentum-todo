-- Momentum Todo — Migration 0002: Stage 5 Onboarding & Timezone
-- Additive and backward-compatible fields on user_settings

ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean DEFAULT false NOT NULL;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "timezone" varchar(100) DEFAULT 'UTC' NOT NULL;
