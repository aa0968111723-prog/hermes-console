import { respond, route } from "@/lib/server/security";
import { sessionSnapshot } from "@/lib/server/auth";

export const runtime = "nodejs";

export const GET = route(async (req) => respond(sessionSnapshot(req)));
