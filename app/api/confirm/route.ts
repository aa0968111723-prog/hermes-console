import { z } from "zod";
import {
  authenticate,
  consumeConfirmation,
  jsonBody,
  mintConfirmation,
  respond,
  route,
} from "@/lib/server/security";
export const runtime = "nodejs";
export const POST = route(async (req) => {
  authenticate(req, true);
  const body = z
    .object({
      action: z.enum([
        "publish",
        "destructive",
        "write",
        "instagram_publish",
        "external_mutation",
        "delete",
        "formal_submit",
      ]),
      target: z.string().min(1).max(200),
      payload: z.unknown(),
      token: z.string().optional(),
      consume: z.boolean().optional(),
    })
    .strict()
    .parse(await jsonBody(req));
  if (body.consume) {
    consumeConfirmation({
      token: body.token,
      action: body.action,
      target: body.target,
      payload: body.payload,
    });
    return respond({ ok: true });
  }
  return respond(mintConfirmation(body));
});
