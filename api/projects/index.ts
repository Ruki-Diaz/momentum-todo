import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthUser } from "../../server/auth.js";
import { getDbHttp, schema } from "../../server/db.js";
import { eq, asc } from "drizzle-orm";
import { validateProjectInput } from "../../server/validators.js";
import { serializeProject } from "../../server/serializers.js";
import { createErrorResponse } from "../../server/errors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireAuthUser(req);
    const db = getDbHttp();

    if (req.method === "GET") {
      const userProjects = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.userId, user.id))
        .orderBy(asc(schema.projects.createdAt));

      return res.status(200).json({
        data: userProjects.map(serializeProject)
      });
    }

    if (req.method === "POST") {
      const input = validateProjectInput(req.body, false);

      const inserted = await db
        .insert(schema.projects)
        .values({
          userId: user.id,
          name: input.name!,
          color: input.color || "#f08352",
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();

      return res.status(201).json({
        data: serializeProject(inserted[0])
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: `Method ${req.method} is not allowed on this endpoint.`
      }
    });
  } catch (error) {
    const errorPayload = createErrorResponse(error);
    return res.status(errorPayload.statusCode).json(errorPayload.body);
  }
}
