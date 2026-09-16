import { z } from "zod";
import { checkOrigin, jsonBody, respond, route } from "@/lib/server/security";
import { requireUser, startGoogleFromRequest, startTamkangFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  checkOrigin(req);
  requireUser(req);
  const input = z
    .object({ provider: z.enum(["google", "tamkang"]) })
    .strict()
    .parse(await jsonBody(req, 1000));
  const url =
    input.provider === "google"
      ? startGoogleFromRequest(req, "link")
      : await startTamkangFromRequest(req, "link");
  return respond({ url });
});
