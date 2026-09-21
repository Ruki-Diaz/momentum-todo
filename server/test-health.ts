/**
 * Local Health & Foundation Test Script for Stage 4A
 */
import handler from "../api/health.js";

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
  setHeader(name: string, value: string): MockResponse;
}

async function runLocalHealthTest() {
  console.log("▶ Running Stage 4A Foundation & Health Check Test...");

  const mockReq: any = {
    method: "GET",
    headers: {}
  };

  const mockRes: MockResponse = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    }
  };

  await handler(mockReq, mockRes as any);

  console.log("✔ Health endpoint response status:", mockRes.statusCode);
  console.log("✔ Health endpoint response body:\n", JSON.stringify(mockRes.body, null, 2));

  if (mockRes.statusCode === 200) {
    console.log("\n🎉 STAGE 4A HEALTH CHECK PASSED!");
  } else {
    console.error("\n❌ Health check returned non-200 status code");
    process.exit(1);
  }
}

runLocalHealthTest();
