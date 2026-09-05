import { NextRequest, NextResponse } from "next/server";
import { searchInspirations, parseInspirationLink } from "@/lib/server/inspiration/engine.ts";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const inspirations = searchInspirations(q);
  return NextResponse.json({ ok: true, inspirations });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawUrl = body.url;
    if (!rawUrl) {
      return NextResponse.json({ error: "請提供靈感網址" }, { status: 400 });
    }
    const parsed = parseInspirationLink(rawUrl);
    return NextResponse.json({ ok: true, analysis: parsed });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
