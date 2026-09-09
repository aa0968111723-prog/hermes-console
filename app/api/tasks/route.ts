import { z } from "zod";
import { ApiError, authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { active, reconcile, stop, submit, taskInput } from "@/lib/server/tasks";
import { acknowledge } from "@/lib/server/task-acknowledge";
import { list } from "@/lib/server/store";
import type { Task } from "@/lib/contracts";
export const runtime = "nodejs";

const STORE_UNAVAILABLE = {
  code: "store_unavailable" as const,
  message: "儲存庫無法使用。",
};

function rethrowUnlessStoreFailure(error: unknown) {
  if (error instanceof ApiError && error.code !== "store_unavailable") throw error;
  if (error instanceof z.ZodError) throw error;
}

export const GET = route(async (req) => {
  const owner = authenticate(req);
  try {
    const tasks = list<Task>("task", owner);
    return respond({
      tasks: await Promise.all(
        tasks.map((t) => (active(t) ? reconcile(owner, t.id) : t)),
      ),
    });
  } catch (error) {
    rethrowUnlessStoreFailure(error);
    return respond({
      tasks: [],
      degraded: true,
      error: STORE_UNAVAILABLE,
    });
  }
});
export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  try {
    return respond(
      { task: await submit(owner, taskInput.parse(await jsonBody(req))) },
      202,
    );
  } catch (error) {
    rethrowUnlessStoreFailure(error);
    throw new ApiError(503, STORE_UNAVAILABLE.code, STORE_UNAVAILABLE.message);
  }
});
export const PATCH = route(async (req) => {
  const owner = authenticate(req, true);
  try {
    const body = z
      .object({
        id: z.string().uuid(),
        action: z.enum(["stop", "acknowledge"]),
      })
      .strict()
      .parse(await jsonBody(req));
    if (body.action === "acknowledge")
      return respond({ task: acknowledge(owner, body.id) });
    return respond({ task: await stop(owner, body.id) });
  } catch (error) {
    rethrowUnlessStoreFailure(error);
    throw new ApiError(503, STORE_UNAVAILABLE.code, STORE_UNAVAILABLE.message);
  }
});
