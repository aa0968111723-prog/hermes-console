import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { health } from "@/lib/server/hermes";
import {
  deleteMemory,
  listMemories,
  memoryInput,
  memoryShareStatus,
  saveMemory,
} from "@/lib/server/memory";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const owner = authenticate(req);
  const scope = new URL(req.url).searchParams.get("scope") || "all";
  const connection = await health(owner);
  return respond({
    memories: listMemories(owner, scope),
    share: memoryShareStatus(owner, connection),
  });
});

export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  return respond(
    { memory: saveMemory(owner, memoryInput.parse(await jsonBody(req, 12_000))) },
    201,
  );
});

export const DELETE = route(async (req) => {
  const owner = authenticate(req, true);
  const body = z
    .object({ id: z.string().uuid() })
    .strict()
    .parse(await jsonBody(req, 2_000));
  return respond(deleteMemory(owner, body.id));
});
