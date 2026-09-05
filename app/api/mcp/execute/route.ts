import { NextRequest, NextResponse } from "next/server";
import { executeMcpTool } from "@/lib/server/mcp/registry.ts";
import { verifySameOrigin, checkRateLimit } from "@/lib/server/security.ts";

export async function POST(req: NextRequest) {
  const originCheck = verifySameOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.reason }, { status: 403 });
  }

  const clientIp = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const rate = checkRateLimit(`mcp_${clientIp}`, 60, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "請求過於頻繁" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { name, args } = body;
    if (!name) {
      return NextResponse.json({ error: "缺少工具名稱" }, { status: 400 });
    }

    const result = await executeMcpTool(name, args || {});
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
