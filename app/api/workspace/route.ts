import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { list, put } from "@/lib/server/store";
import type { Conversation, Material } from "@/lib/contracts";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const owner = authenticate(req);
  return respond({
    conversations: list<Conversation>("conversation", owner),
    projects: list("project", owner),
    materials: list<Material>("material", owner),
    imageInput: process.env.HERMES_IMAGE_INPUT === "true",
    memory: {
      status: "unsupported",
      scope:
        "單一擁有者的 Hermes profile；未驗證跨專案長期記憶隔離與部署持久性。",
      synced: false,
    },
  });
});
export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  const body = z
    .object({ name: z.string().trim().min(1).max(80) })
    .strict()
    .parse(await jsonBody(req));
  return respond(
    {
      project: put("project", owner, {
        id: randomUUID(),
        name: body.name,
        createdAt: new Date().toISOString(),
      }),
    },
    201,
  );
});
