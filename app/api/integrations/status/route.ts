import { NextRequest, NextResponse } from "next/server";
import { getAllIntegrationsReport } from "@/lib/server/integrations/truth-status.ts";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rawUrl = url.searchParams.get("baseUrl") || undefined;
  const apiKey = url.searchParams.get("apiKey") || undefined;

  const report = await getAllIntegrationsReport({ rawUrl, apiKey });
  return NextResponse.json({ ok: true, ...report });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const report = await getAllIntegrationsReport({
    rawUrl: body.baseUrl,
    apiKey: body.apiKey
  });
  return NextResponse.json({ ok: true, ...report });
}
