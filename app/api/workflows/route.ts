import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  chooseDirection,
  forkArtifact,
  listWorkflows,
  pollDraft,
  restoreArtifact,
} from "@/lib/server/workflows";
import { listArtifacts } from "@/lib/server/artifacts";
export const GET = route(async (req) => {
  const owner = authenticate(req);
  return respond({
    workflows: listWorkflows(owner),
    artifacts: listArtifacts(owner),
  });
});
export const PATCH = route(async (req) => {
  const owner = authenticate(req, true);
  const input = z
    .union([
      z
        .object({
          id: z.string().regex(/^[a-f0-9]{64}$/),
          selected: z.number().int().min(0).max(4),
        })
        .strict(),
      z
        .object({
          id: z.string().regex(/^[a-f0-9]{64}$/),
          restoreRevision: z.number().int().min(1),
        })
        .strict(),
      z
        .object({
          id: z.string().regex(/^[a-f0-9]{64}$/),
          fork: z.literal(true),
          forkRevision: z.number().int().min(1).optional(),
        })
        .strict(),
    ])
    .parse(await jsonBody(req));
  if ("selected" in input)
    return respond({
      workflow: chooseDirection(owner, input.id, input.selected),
    });
  if ("restoreRevision" in input)
    return respond({
      workflow: restoreArtifact(owner, input.id, input.restoreRevision),
    });
  return respond({
    workflow: forkArtifact(owner, input.id, input.forkRevision),
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
