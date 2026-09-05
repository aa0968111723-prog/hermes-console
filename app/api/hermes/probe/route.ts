import { NextRequest, NextResponse } from "next/server";
import { probeHermesCapabilities } from "@/lib/server/hermes";
import { checkRateLimit } from "@/lib/server/security";

export async function POST(req: NextRequest) {
  const clientIp = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const rate = checkRateLimit(`probe_${clientIp}`, 30, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "探測過於頻繁" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const report = await probeHermesCapabilities(body.baseUrl, body.apiKey);
    return NextResponse.json({ ok: true, report });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
