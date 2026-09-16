import { authenticate, respond, route } from "@/lib/server/security";
import { TamkangAuthProvider } from "@/lib/server/auth/providers/tamkang";

export const runtime = "nodejs";

export const GET = route(async (request) => {
  authenticate(request, false, { anonymous: true });
  if (!TamkangAuthProvider.isConfigured())
    return respond(
      {
        configured: false,
        protocol: TamkangAuthProvider.protocol(),
        message: TamkangAuthProvider.unavailableMessage(),
      },
      503,
    );
  TamkangAuthProvider.start();
  return respond({ configured: true });
});
