import { z } from "zod";
import { ApiError, authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { health } from "@/lib/server/hermes";
import {
  deleteMemory,
  listMemories,
  memoryEvidenceKind,
  memoryInput,
  memoryShareStatus,
  memoryStoreId,
  memoryWriteApiEnabled,
  writeMemoryWithReadBack,
} from "@/lib/server/memory";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const owner = authenticate(req);
  const scope = new URL(req.url).searchParams.get("scope") || "all";
  try {
    const connection = await health(owner);
    const share = memoryShareStatus(owner, connection);
    return respond({
      memories: listMemories(owner, scope),
      share,
      evidence: {
        kind: memoryEvidenceKind(),
        store: memoryStoreId(),
        operation: "read" as const,
        memory_write_api: memoryWriteApiEnabled(),
      },
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
    const proof = writeMemoryWithReadBack(
      owner,
      memoryInput.parse(await jsonBody(req, 12_000)),
    );
    return respond(
      {
        memory: proof.memory,
        readBack: proof.readBack,
        evidence: proof.evidence,
        memory_write_api: memoryWriteApiEnabled(),
      },
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
