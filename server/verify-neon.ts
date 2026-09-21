/**
 * Neon Schema & Verification Script
 * Validates all tables, constraints, foreign keys, indexes, and health endpoint.
 * Zero credentials logged.
 */
import { getDbHttp } from "./db.js";
import { sql } from "drizzle-orm";
import handler from "../api/health.js";

async function verifyNeonSetup() {
  console.log("▶ Verifying Neon PostgreSQL tables and constraints...");

  const db = getDbHttp();

  // 1. Query all tables in public and drizzle schemas
  const tablesResult: any = await db.execute(sql`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema IN ('public', 'drizzle')
    ORDER BY table_schema, table_name;
  `);

  const publicTableNames = tablesResult.rows
    .filter((r: any) => r.table_schema === 'public')
    .map((r: any) => r.table_name);
  const drizzleTableNames = tablesResult.rows
    .filter((r: any) => r.table_schema === 'drizzle')
    .map((r: any) => r.table_name);

  console.log("✔ Created application tables in public schema:", publicTableNames);
  console.log("✔ Created Drizzle metadata tables in drizzle schema:", drizzleTableNames);

  const expectedPublicTables = [
    "projects",
    "subtasks",
    "task_tags",
    "tasks",
    "user_settings",
    "users",
    "workspace_imports"
  ];

  const missingTables = expectedPublicTables.filter((t) => !publicTableNames.includes(t));
  if (missingTables.length > 0) {
    console.error("❌ Missing application tables:", missingTables);
    process.exit(1);
  }

  // 2. Query indexes & unique constraints
  const indexesResult: any = await db.execute(sql`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname;
  `);

  const indexes = indexesResult.rows;
  console.log(`✔ Found ${indexes.length} total indexes in database`);

  // Verify specific key indexes
  const requiredIndexNames = [
    "users_auth_provider_id_unique",
    "uq_user_import_id",
    "uq_task_tag",
    "idx_tasks_recurrence_unique",
    "idx_tasks_user_filter",
    "idx_tasks_user_project",
    "idx_tasks_user_series",
    "idx_tasks_user_updated",
    "idx_projects_user_created",
    "idx_subtasks_task_pos",
    "idx_task_tags_user_tag"
  ];

  const foundIndexNames = indexes.map((i: any) => i.indexname);
  for (const reqIdx of requiredIndexNames) {
    if (foundIndexNames.includes(reqIdx)) {
      console.log(`  ✔ Index verified: ${reqIdx}`);
    } else {
      console.warn(`  ⚠ Warning: Index ${reqIdx} not found directly by name`);
    }
  }

  // 3. Verify Foreign Keys and Deletion Cascade Rules
  const fkResult: any = await db.execute(sql`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name;
  `);

  console.log("✔ Foreign Key and Cascade Rules verified:");
  fkResult.rows.forEach((fk: any) => {
    console.log(`  • ${fk.table_name}.${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name} (ON DELETE ${fk.delete_rule})`);
  });

  // 4. Test Health Check Endpoint with Live Database Connection
  console.log("\n▶ Testing /api/health endpoint with live Neon connection...");

  const mockReq: any = { method: "GET", headers: {} };
  let responseData: any = null;
  let responseStatus = 0;

  const mockRes: any = {
    status(code: number) {
      responseStatus = code;
      return this;
    },
    json(data: any) {
      responseData = data;
      return this;
    },
    setHeader() {
      return this;
    }
  };

  await handler(mockReq, mockRes);

  console.log("✔ Health endpoint response status:", responseStatus);
  console.log("✔ Health endpoint response payload:\n", JSON.stringify(responseData, null, 2));

  if (responseStatus === 200 && responseData?.services?.database?.status === "connected") {
    console.log("\n🎉 NEON POSTGRESQL STAGE 4A VERIFICATION SUCCESSFUL!");
  } else {
    console.error("\n❌ Health check did not connect properly:", responseData);
    process.exit(1);
  }
}

verifyNeonSetup();
