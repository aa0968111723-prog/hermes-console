import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  forkArtifact,
  listArtifacts,
  restoreArtifact,
} from "@/lib/server/artifacts";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const owner = authenticate(req);
  const projectId = new URL(req.url).searchParams.get("projectId") || undefined;
  return respond({ artifacts: listArtifacts(owner, projectId) });
});

export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  const input = z
    .object({
      action: z.enum(["restore", "fork"]),
      artifactId: z.string().uuid(),
      revisionId: z.string().uuid().optional(),
    })
    .strict()
    .parse(await jsonBody(req, 2000));
  if (input.action === "fork")
    return respond({ artifact: forkArtifact(owner, input.artifactId) }, 201);
  if (!input.revisionId)
    return respond(
      { error: { code: "revision_required", message: "還原需要 revisionId。" } },
      400,
    );
  return respond({
    artifact: restoreArtifact(owner, input.artifactId, input.revisionId),
  });
});
