import { respond, route } from "@/lib/server/security";

export const runtime = "nodejs";

export const GET = route(async () =>
  respond({ live: true, service: "hermes-console" }),
);
