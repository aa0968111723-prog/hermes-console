import { authenticate, route, verifyGateway } from "@/lib/server/security";
import { runtimeStream } from "@/lib/server/hermes/runtime-stream";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const owner = authenticate(req);
  return runtimeStream(req, owner, () => {
    if (
      process.env.CONSOLE_GATEWAY_SECRET ||
      process.env.CONSOLE_REQUIRE_GATEWAY === "true"
    )
      verifyGateway(req);
  });
});
