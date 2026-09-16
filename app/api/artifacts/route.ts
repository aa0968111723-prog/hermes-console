import { z } from "zod";
import {
  authenticate,
  checkOrigin,
  jsonBody,
  respond,
  route,
} from "@/lib/server/security";
import {
  forkArtifact,
  listArtifacts,
  restoreArtifact,
} from "@/lib/server/artifacts";
import { projectKey } from "@/lib/creative";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const owner = authenticate(req);
  const projectId = new URL(req.url).searchParams.get("projectId") || undefined;
  if (projectId) projectKey.parse(projectId);
  return respond({ artifacts: listArtifacts(owner, projectId) });
});

export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  checkOrigin(req);
  const input = z
    .discriminatedUnion("action", [
      z
        .object({
          action: z.literal("restore"),
          artifactId: z.string().uuid(),
          revisionId: z.string().min(1).max(12),
          expectedRevision: z.number().int().min(0),
        })
        .strict(),
      z
        .object({
          action: z.literal("fork"),
          artifactId: z.string().uuid(),
          revisionId: z.string().min(1).max(12).optional(),
          operationId: z.string().uuid(),
        })
        .strict(),
    ])
    .parse(await jsonBody(req, 4000));
  if (input.action === "restore")
    return respond({
      artifact: restoreArtifact(
        owner,
        input.artifactId,
        input.revisionId,
        input.expectedRevision,
      ),
    });
  return respond(
    {
      artifact: forkArtifact(
        owner,
        input.artifactId,
        input.revisionId,
        input.operationId,
      ),
    },
    201,
  );
});
