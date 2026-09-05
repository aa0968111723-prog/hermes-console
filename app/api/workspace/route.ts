import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { list, put } from "@/lib/server/store";
import type { Conversation, Material } from "@/lib/contracts";
import { health } from "@/lib/server/hermes";
import { capabilityFromHealth } from "@/lib/server/agents";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const owner = authenticate(req);
  const connection = await health(owner);
  const capabilities = capabilityFromHealth(connection);
  return respond({
    conversations: list<Conversation>("conversation", owner),
    projects: list("project", owner),
    materials: list<Material>("material", owner),
    imageInput: process.env.HERMES_IMAGE_INPUT === "true",
    memory: {
      status: capabilities.memory,
      scope: "單一工作區 namespace；不是多人租戶。",
      synced: capabilities.memory === "available",
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
