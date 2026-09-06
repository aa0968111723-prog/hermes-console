import { NextRequest, NextResponse } from "next/server";
import { runCreativeIntelligencePipeline } from "@/lib/server/creative-workflow/pipeline.ts";
import { requireWriteOrigin, checkRateLimit } from "@/lib/server/security.ts";

export async function POST(req: NextRequest) {
  // 1. 同源寫入防護
  const originCheck = requireWriteOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.reason }, { status: 403 });
  }

  // 2. 速率限制防護
  const clientIp = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const rate = checkRateLimit(`pipeline_${clientIp}`, 30, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "創意管線請求頻繁，請稍候再試" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const userPrompt = String(body.prompt || body.query || "幫我做給淡江大學大一新生看的禪學社茶會網宣").trim();
    const activeProject = body.activeProject || "tku-zen-agent";
    const sessionKey = req.headers.get("x-hermes-session-key") || body.sessionKey;

    const result = await runCreativeIntelligencePipeline(userPrompt, {
      activeProject,
      sessionKey
    });

    return NextResponse.json({
      ok: true,
      pipeline: result
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
