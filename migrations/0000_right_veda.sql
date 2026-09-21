CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(20) DEFAULT '#f08352' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subtasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tag" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_task_tag" UNIQUE("task_id","tag")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"title" varchar(255) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"due_date" date,
	"due_time" time,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"reminder" varchar(20),
	"recurrence" varchar(20) DEFAULT 'none' NOT NULL,
	"recurrence_series_id" uuid,
	"generated_next_occurrence_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" varchar(20) DEFAULT 'dark' NOT NULL,
	"sort_preference" varchar(30) DEFAULT 'smart' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_provider_id" varchar(255) NOT NULL,
	"email" varchar(320),
	"display_name" varchar(255),
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_provider_id_unique" UNIQUE("auth_provider_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"source" varchar(50) DEFAULT 'local_storage' NOT NULL,
	"task_count" integer DEFAULT 0 NOT NULL,
	"project_count" integer DEFAULT 0 NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	CONSTRAINT "uq_user_import_id" UNIQUE("user_id","import_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_imports" ADD CONSTRAINT "workspace_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_projects_user_created" ON "projects" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_subtasks_task_pos" ON "subtasks" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "idx_subtasks_user" ON "subtasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_task_tags_user_tag" ON "task_tags" USING btree ("user_id","tag");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_filter" ON "tasks" USING btree ("user_id","completed","due_date");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_project" ON "tasks" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_series" ON "tasks" USING btree ("user_id","recurrence_series_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_updated" ON "tasks" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tasks_recurrence_unique" ON "tasks" USING btree ("user_id","recurrence_series_id","due_date") WHERE "tasks"."recurrence_series_id" IS NOT NULL AND "tasks"."due_date" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_users_auth_provider" ON "users" USING btree ("auth_provider_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_imports_user" ON "workspace_imports" USING btree ("user_id");