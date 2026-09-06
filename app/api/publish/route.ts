import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  confirmPublish,
  instagramPublishStatus,
  requestPublishConfirmation,
} from "@/lib/server/publish";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  authenticate(req);
  return respond(instagramPublishStatus());
});

export const POST = route(async (req) => {
  authenticate(req, true);
  const body = z
    .object({
      caption: z.string().min(1).max(2200),
      mediaId: z.string().min(1).max(200),
      target: z.string().min(1).max(200),
      token: z.string().optional(),
      confirmed: z.boolean().optional(),
      prepare: z.boolean().optional(),
      allowSandbox: z.boolean().optional(),
      idempotencyKey: z.string().max(100).optional(),
    })
    .strict()
    .parse(await jsonBody(req));

  if (body.prepare) {
    return respond(
      requestPublishConfirmation({
        caption: body.caption,
        mediaId: body.mediaId,
        target: body.target,
      }),
    );
  }

  const result = confirmPublish(body);
  return respond({ ok: true, result });
});
