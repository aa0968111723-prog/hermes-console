import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  chooseDirection,
  listWorkflows,
  pollDraft,
} from "@/lib/server/workflows";
export const GET = route(async (req) =>
  respond({ workflows: listWorkflows(authenticate(req)) }),
);
export const PATCH = route(async (req) => {
  const owner = authenticate(req, true);
  const input = z
    .object({
      id: z.string().regex(/^[a-f0-9]{64}$/),
      selected: z.number().int().min(0).max(2),
    })
    .strict()
    .parse(await jsonBody(req));
  return respond({
    workflow: chooseDirection(owner, input.id, input.selected),
  });
});
export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  const input = z
    .object({ id: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .parse(await jsonBody(req));
  return respond({ workflow: await pollDraft(owner, input.id) });
});
