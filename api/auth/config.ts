import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as dotenv from "dotenv";

dotenv.config({ override: true });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: `Method ${req.method} is not allowed on this endpoint.`
      }
    });
  }

  const publishableKey = process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || "";

  return res.status(200).json({
    publishableKey
  });
}
