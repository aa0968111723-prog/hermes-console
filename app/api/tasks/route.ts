import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { active, reconcile, stop, submit, taskInput } from "@/lib/server/tasks";
import { acknowledge } from "@/lib/server/task-acknowledge";
import { list } from "@/lib/server/store";
import type { Task } from "@/lib/contracts";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const owner = authenticate(req);
  const tasks = list<Task>("task", owner);
  return respond({
    tasks: await Promise.all(
      tasks.map((t) => (active(t) ? reconcile(owner, t.id) : t)),
    ),
  });
});
export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  return respond(
    { task: await submit(owner, taskInput.parse(await jsonBody(req))) },
    202,
  );
});
export const PATCH = route(async (req) => {
  const owner = authenticate(req, true);
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
});
