import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { emailInput, invite, members, requireAdmin, revoke } from "@/lib/server/invitations";
export const runtime = "nodejs";
export const GET = route(async req => {
  authenticate(req); requireAdmin(req);
  return respond({ members: members() });
});
export const POST = route(async req => {
  authenticate(req, true); requireAdmin(req);
  const body = z.object({ email: emailInput }).strict().parse(await jsonBody(req, 2000));
  return respond({ member: await invite(body.email), notice: "寄信服務已接受；不等於收件匣已送達。" }, 201);
});
export const DELETE = route(async req => {
  authenticate(req, true);
  const actor = requireAdmin(req);
  const body = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await jsonBody(req, 2000));
  return respond(revoke(body.id, actor));
});
