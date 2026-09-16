import { TamkangAuthProvider } from "@/lib/server/auth/providers/tamkang";

export const runtime = "nodejs";

export const GET = async () => {
  const message = TamkangAuthProvider.unavailableMessage();
  const origin = process.env.CONSOLE_ORIGIN || "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: origin + "/?auth_error=" + encodeURIComponent(message),
      "Cache-Control": "no-store",
    },
  });
};
