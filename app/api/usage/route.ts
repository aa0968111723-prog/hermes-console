import { authenticate, respond, route } from "@/lib/server/security";
import { aggregateUsage } from "@/lib/server/usage";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  authenticate(req);
  const range = new URL(req.url).searchParams.get("range") || "all";
  const allowed = ["today", "7d", "30d", "all"] as const;
  return respond(
    aggregateUsage(
      allowed.includes(range as (typeof allowed)[number])
        ? (range as (typeof allowed)[number])
        : "all",
    ),
  );
});
