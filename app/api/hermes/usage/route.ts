import { NextRequest, NextResponse } from "next/server";
import { getUsageSummary, listRecentUsageEvents } from "@/lib/server/hermes/usage";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionKey = url.searchParams.get("sessionKey") || undefined;
  const summary = getUsageSummary(sessionKey);
  const events = listRecentUsageEvents(20, sessionKey);
  return NextResponse.json({
    ok: true,
    summary,
    events,
    cost: null,
    costNotice: "Provider price is unknown; USD cost is not estimated.",
  });
}
