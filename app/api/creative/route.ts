import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { list } from "@/lib/server/store";
import {
  activityInput,
  copyInput,
  projectKey,
  type Activity,
  type CopyDocument,
} from "@/lib/creative";
import {
  assertProject,
  saveActivity,
  confirmFacts,
  saveCopy,
  selectCopy,
  checkCopy,
  exportCopy,
} from "@/lib/server/creative";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const owner = authenticate(req),
    url = new URL(req.url);
  if (url.searchParams.get("download")) {
    const id = z.string().uuid().parse(url.searchParams.get("download"));
    const revision = z.coerce
      .number()
      .int()
      .positive()
      .parse(url.searchParams.get("revision"));
    const text = exportCopy(owner, id, revision);
    return new Response(text, {
      headers: {
        "Content-Type": "text/markdown;charset=utf-8",
        "Content-Disposition": `attachment; filename="draft-${id}-v${revision}.md"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const project = projectKey.parse(
    url.searchParams.get("projectId") || "personal",
  );
  assertProject(owner, project);
  return respond({
    activities: list<Activity>("activity", owner).filter(
      (a) => a.projectId === project,
    ),
    copies: list<CopyDocument>("copy", owner)
      .filter((c) => c.projectId === project)
      .map((c) => ({ ...c, check: checkCopy(owner, c) })),
  });
});
export const POST = route(async (req) => {
  const owner = authenticate(req, true),
    body = z
      .discriminatedUnion("kind", [
        z
          .object({ kind: z.literal("activity"), input: activityInput })
          .strict(),
        z.object({ kind: z.literal("copy"), input: copyInput }).strict(),
      ])
      .parse(await jsonBody(req, 150_000));
  return respond(
    body.kind === "activity"
      ? { activity: saveActivity(owner, body.input, "owner") }
      : { copy: saveCopy(owner, body.input, "owner") },
    201,
  );
});
export const PATCH = route(async (req) => {
  const owner = authenticate(req, true),
    body = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("confirm_facts"),
            id: z.string().uuid(),
            expectedRevision: z.number().int().positive(),
            factIds: z.array(z.string().max(64)).max(60),
          })
          .strict(),
        z
          .object({
            action: z.literal("select_copy"),
            id: z.string().uuid(),
            expectedRevision: z.number().int().positive(),
            revision: z.number().int().positive(),
          })
          .strict(),
      ])
      .parse(await jsonBody(req));
  return respond(
    body.action === "confirm_facts"
      ? {
          activity: confirmFacts(
            owner,
            body.id,
            body.expectedRevision,
            body.factIds,
          ),
        }
      : {
          copy: selectCopy(
            owner,
            body.id,
            body.expectedRevision,
            body.revision,
          ),
        },
  );
});
