ALTER TABLE "projects" ADD COLUMN "legacy_source" varchar(50);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "legacy_id" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_projects_user_legacy_unique" ON "projects" USING btree ("user_id","legacy_source","legacy_id") WHERE "projects"."legacy_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "legacy_source" varchar(50);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "legacy_id" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tasks_user_legacy_unique" ON "tasks" USING btree ("user_id","legacy_source","legacy_id") WHERE "tasks"."legacy_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_imports" ALTER COLUMN "source" SET DEFAULT 'momentum-local-v2';--> statement-breakpoint
ALTER TABLE "workspace_imports" ADD COLUMN "subtask_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_imports" ADD COLUMN "tag_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_imports" ADD COLUMN "remapped_project_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_imports" ADD COLUMN "remapped_task_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_imports" ADD COLUMN "remapped_subtask_count" integer DEFAULT 0 NOT NULL;
