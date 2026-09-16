import { z } from "zod";
import {
  authenticate,
  jsonBody,
  readWorkspaceRole,
  respond,
  route,
} from "@/lib/server/security";
import { isAuthEnforced, readSessionUser } from "@/lib/server/auth/session";
import { ApiError } from "@/lib/server/errors";
import {
  forkArtifact,
  listArtifacts,
  restoreArtifact,
} from "@/lib/server/artifacts";
import { projectKey } from "@/lib/creative";

export const runtime = "nodejs";

function requireWorkspaceSession(req: Request) {
  if (!isAuthEnforced()) return;
  if (readWorkspaceRole(req) || readSessionUser(req)) return;
  throw new ApiError(401, "sign_in_required", "請先登入後再使用工作區。");
}

export const GET = route(async (req) => {
  requireWorkspaceSession(req);
  const owner = authenticate(req);
  const projectId = new URL(req.url).searchParams.get("projectId") || undefined;
  if (projectId) projectKey.parse(projectId);
  return respond({ artifacts: listArtifacts(owner, projectId) });
});

export const POST = route(async (req) => {
  requireWorkspaceSession(req);
  const owner = authenticate(req, true);
  const input = z
    .object({
      action: z.enum(["restore", "fork"]),
      artifactId: z.string().uuid(),
      revisionId: z.string().min(1).max(64).optional(),
      expectedRevision: z.number().int().min(0).optional(),
      operationId: z.string().uuid().optional(),
    })
    .strict()
    .parse(await jsonBody(req, 4000));
  if (input.action === "fork") {
    if (input.operationId)
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
    return respond({ artifact: forkArtifact(owner, input.artifactId) }, 201);
  }
  if (!input.revisionId)
    return respond(
      { error: { code: "revision_required", message: "還原需要 revisionId。" } },
      400,
    );
  if (input.expectedRevision != null)
    return respond({
      artifact: restoreArtifact(
        owner,
        input.artifactId,
        input.revisionId,
        input.expectedRevision,
      ),
    });
  return respond({
    artifact: restoreArtifact(owner, input.artifactId, input.revisionId),
  });
});
