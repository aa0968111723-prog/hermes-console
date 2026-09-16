import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  forkArtifact,
  listArtifacts,
  listRevisions,
  restoreRevision,
} from "@/lib/server/artifacts";

export const runtime = "nodejs";

export const GET = route(async (request) => {
  authenticate(request);
  const url = new URL(request.url);
  const artifactId = url.searchParams.get("artifactId");
  if (artifactId)
    return respond({ revisions: listRevisions(artifactId) });
  return respond({
    artifacts: listArtifacts(undefined, url.searchParams.get("projectId") || undefined),
  });
});

export const POST = route(async (request) => {
  authenticate(request, true);
  const input = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("restore"), id: z.string().uuid() }),
      z.object({ action: z.literal("fork"), id: z.string().uuid() }),
    ])
    .parse(await jsonBody(request, 2000));
  const artifact =
    input.action === "restore" ? restoreRevision(input.id) : forkArtifact(input.id);
  return respond({ artifact });
});
