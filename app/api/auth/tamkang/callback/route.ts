import { authCookie, finishTamkang } from "@/lib/server/auth";

export const runtime = "nodejs";

function home(req: Request) {
  try {
    return new URL(process.env.CONSOLE_ORIGIN || req.url).origin + "/";
  } catch {
    return "/";
  }
}

export async function GET(req: Request) {
  try {
    const result = await finishTamkang(req);
    const headers = new Headers({ Location: home(req), "Cache-Control": "no-store" });
    if (result.token) headers.set("Set-Cookie", authCookie(result.token));
    return new Response(null, { status: 303, headers });
  } catch {
    return new Response(null, {
      status: 303,
      headers: { Location: home(req) + "?auth=failed", "Cache-Control": "no-store" },
    });
  }
}
