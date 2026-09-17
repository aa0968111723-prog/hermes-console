import { jsonBody, respond, route } from "@/lib/server/security";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  const body = await jsonBody(req, 16_000).catch(() => ({}));
  const record = body && typeof body === "object" ? body : {};
  console.error("[client-error]", {
    message: String((record as { message?: unknown }).message || "unknown"),
    stack: String((record as { stack?: unknown }).stack || "").slice(0, 8000),
    componentStack: String(
      (record as { componentStack?: unknown }).componentStack || "",
    ).slice(0, 8000),
    href: String((record as { href?: unknown }).href || "").slice(0, 500),
    at: String((record as { at?: unknown }).at || new Date().toISOString()),
  });
  return respond({ ok: true });
});
