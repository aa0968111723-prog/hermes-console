import { authenticate, respond } from "@/lib/server/security";
import { TamkangAuthProvider } from "@/lib/server/auth/providers/tamkang";
import { readAccess } from "@/lib/server/auth/session";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
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
    const location = await TamkangAuthProvider.start(
      readAccess(request)?.user.id,
    );
    return new Response(null, {
      status: 302,
      headers: { Location: location, "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : TamkangAuthProvider.unavailableMessage();
    return new Response(null, {
      status: 302,
      headers: {
        Location:
          (process.env.CONSOLE_ORIGIN || "") +
          "/?auth_error=" +
          encodeURIComponent(message),
        "Cache-Control": "no-store",
      },
    });
  }
};
