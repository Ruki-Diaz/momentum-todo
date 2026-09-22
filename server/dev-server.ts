import http from "http";
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
import healthHandler from "../api/health.js";
import authMeHandler from "../api/auth/me.js";
import authConfigHandler from "../api/auth/config.js";
import projectsIndexHandler from "../api/projects/index.js";
import projectIdHandler from "../api/projects/[id].js";
import tasksIndexHandler from "../api/tasks/index.js";
import taskIdHandler from "../api/tasks/[id].js";
import taskCompleteHandler from "../api/tasks/[id]/complete.js";
import taskSubtasksIndexHandler from "../api/tasks/[id]/subtasks/index.js";
import taskSubtaskIdHandler from "../api/tasks/[id]/subtasks/[subtaskId].js";
import settingsHandler from "../api/settings/index.js";
import workspaceImportHandler from "../api/workspace/import.js";

dotenv.config({ override: true });

const PORT = parseInt(process.env.PORT || "8088", 10);
const PUBLIC_DIR = path.join(process.cwd(), "public");
const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MB — must stay below Vercel's 4.5 MB hard platform limit

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function createVercelResponse(res: http.ServerResponse) {
  const customRes: any = res;
  customRes.status = function (statusCode: number) {
    res.statusCode = statusCode;
    return customRes;
  };
  customRes.json = function (data: unknown) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
    return customRes;
  };
  return customRes;
}

const server = http.createServer(async (req, res) => {
  // CORS Headers for Local Development
  const origin = req.headers.origin || "http://localhost:8088";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-test-user-id");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost:8088"}`);
  const pathname = url.pathname;

  // Read body buffer with early payload size enforcement
  let parsedBody: any = undefined;
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let payloadTooLarge = false;

    for await (const chunk of req) {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      receivedBytes += buf.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        payloadTooLarge = true;
        break;
      }
      chunks.push(buf);
    }

    if (payloadTooLarge) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request payload exceeds maximum limit of 5MB" } }));
      return;
    }

    const rawBody = Buffer.concat(chunks).toString("utf-8");
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }
  }

  // 1. API Route Dispatcher
  const vercelRes = createVercelResponse(res);
  const vercelReq: any = req;
  vercelReq.query = Object.fromEntries(url.searchParams.entries());
  vercelReq.body = parsedBody;

  // Static / Auth Endpoints
  if (pathname === "/api/health") {
    await healthHandler(vercelReq, vercelRes);
    return;
  }
  if (pathname === "/api/auth/me") {
    await authMeHandler(vercelReq, vercelRes);
    return;
  }
  if (pathname === "/api/auth/config") {
    await authConfigHandler(vercelReq, vercelRes);
    return;
  }

  // Workspace Import Endpoint (Stage 4E)
  if (pathname === "/api/workspace/import") {
    await workspaceImportHandler(vercelReq, vercelRes);
    return;
  }

  // Projects Endpoints
  if (pathname === "/api/projects") {
    await projectsIndexHandler(vercelReq, vercelRes);
    return;
  }
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch) {
    vercelReq.query.id = projectMatch[1];
    await projectIdHandler(vercelReq, vercelRes);
    return;
  }

  // Tasks Subtasks Endpoints
  const subtaskItemMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/subtasks\/([^/]+)$/);
  if (subtaskItemMatch) {
    vercelReq.query.id = subtaskItemMatch[1];
    vercelReq.query.subtaskId = subtaskItemMatch[2];
    await taskSubtaskIdHandler(vercelReq, vercelRes);
    return;
  }

  const subtaskListMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/subtasks$/);
  if (subtaskListMatch) {
    vercelReq.query.id = subtaskListMatch[1];
    await taskSubtasksIndexHandler(vercelReq, vercelRes);
    return;
  }

  // Task Recurring Complete Endpoint
  const taskCompleteMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  if (taskCompleteMatch) {
    vercelReq.query.id = taskCompleteMatch[1];
    await taskCompleteHandler(vercelReq, vercelRes);
    return;
  }

  // Task Single Item Endpoint
  const taskItemMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskItemMatch) {
    vercelReq.query.id = taskItemMatch[1];
    await taskIdHandler(vercelReq, vercelRes);
    return;
  }

  // Task List Endpoint
  if (pathname === "/api/tasks") {
    await tasksIndexHandler(vercelReq, vercelRes);
    return;
  }

  // Settings Endpoints
  if (pathname === "/api/settings") {
    await settingsHandler(vercelReq, vercelRes);
    return;
  }

  // 2. Static File Serving
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Momentum Local Server running at http://localhost:${PORT}`);
});
