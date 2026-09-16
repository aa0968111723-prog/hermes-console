import { TamkangAuthProvider } from "@/lib/server/auth/providers/tamkang";
import { readAccess } from "@/lib/server/auth/session";

export const runtime = "nodejs";

function home(error?: string) {
  const origin = process.env.CONSOLE_ORIGIN || "";
  if (error)
    return origin + "/?auth_error=" + encodeURIComponent(error);
  return origin + "/";
}

export const GET = async (request: Request) => {
  try {
    const url = new URL(request.url);
    const issued = await TamkangAuthProvider.callback(
      url,
      readAccess(request)?.user.id,
    );
    return new Response(null, {
      status: 302,
      headers: {
        Location: home(),
        "Set-Cookie": issued.header,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: home(
          error instanceof Error
            ? error.message
            : "淡江 SSO 尚未完成設定",
        ),
        "Cache-Control": "no-store",
      },
    });
  }
};
