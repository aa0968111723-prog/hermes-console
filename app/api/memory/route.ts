import { z } from "zod";
import { ApiError, authenticate, jsonBody, respond, route } from "@/lib/server/security";
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
  try {
    const connection = await health(owner);
    return respond({
      memories: listMemories(owner, scope),
      share: memoryShareStatus(owner, connection),
    });
  } catch (error) {
    if (error instanceof ApiError && error.code !== "store_unavailable")
      throw error;
    return respond(
      {
        memories: [],
        error: {
          code: "store_unavailable",
          message: "儲存庫無法使用。",
        },
      },
      503,
    );
  }
});

export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  try {
    return respond(
      { memory: saveMemory(owner, memoryInput.parse(await jsonBody(req, 12_000))) },
      201,
    );
  } catch (error) {
    if (error instanceof ApiError || error instanceof z.ZodError) throw error;
    throw new ApiError(503, "store_unavailable", "儲存庫無法使用。");
  }
});

export const DELETE = route(async (req) => {
  const owner = authenticate(req, true);
  try {
    const body = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await jsonBody(req, 2_000));
    return respond(deleteMemory(owner, body.id));
  } catch (error) {
    if (error instanceof ApiError || error instanceof z.ZodError) throw error;
    throw new ApiError(503, "store_unavailable", "儲存庫無法使用。");
  }
});
