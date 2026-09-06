import { NextResponse } from "next/server";
import { getAllIntegrationsReport } from "@/lib/server/integrations/truth-status.ts";
import { checkRateLimit, requireWriteOrigin } from "@/lib/server/security.ts";

function rejectClientCredentials(source: { baseUrl?: unknown; apiKey?: unknown }) {
  if (source.baseUrl || source.apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "Client-supplied Hermes URL or API key is not allowed. Use server env references.",
      },
      { status: 400 },
    );
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const blocked = rejectClientCredentials({
    baseUrl: url.searchParams.get("baseUrl") || undefined,
    apiKey: url.searchParams.get("apiKey") || undefined,
  });
  if (blocked) return blocked;
  const report = await getAllIntegrationsReport();
  return NextResponse.json({ ok: true, ...report });
}

export async function POST(req: Request) {
  const originCheck = requireWriteOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.reason }, { status: 403 });
  }
  const clientIp = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const rate = checkRateLimit(`integrations_status_${clientIp}`, 30, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "探測過於頻繁" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const blocked = rejectClientCredentials(body as { baseUrl?: unknown; apiKey?: unknown });
  if (blocked) return blocked;
  const report = await getAllIntegrationsReport();
  return NextResponse.json({ ok: true, ...report });
}
