import { z } from "zod";
import {
  authenticate,
  jsonBody,
  respond,
  route,
} from "@/lib/server/security";
import { canvaStatus, startCanvaAuth, verifyCanva } from "@/lib/server/canva";
export const runtime = "nodejs";
export const GET = route(async (req) =>
  respond(canvaStatus(authenticate(req))),
);
export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  const body = z
    .object({ action: z.enum(["authorize", "verify"]) })
    .strict()
    .parse(await jsonBody(req));
  if (body.action === "verify") return respond(await verifyCanva(owner));
  const auth = startCanvaAuth(owner);
  // Lax one-use state cookie allows the cross-site OAuth callback; the main session stays Strict.
  return respond({ url: auth.url }, 200, {
    "Set-Cookie": `canva_oauth=${auth.state}; HttpOnly; SameSite=Lax; Path=/api/canva; Max-Age=600${process.env.CONSOLE_ORIGIN?.startsWith("https:") ? "; Secure" : ""}`,
  });
});
