import { NextRequest, NextResponse } from "next/server";
import { simulateAudienceReaction } from "@/lib/server/audience-twin/engine.ts";
import { runReverseThinkingEvaluation } from "@/lib/server/audience-twin/reverse-thinking.ts";
import { wantsReverseThinking } from "@/lib/server/audience.ts";
import { verifySameOrigin, checkRateLimit } from "@/lib/server/security.ts";

export async function POST(req: NextRequest) {
  const originCheck = verifySameOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.reason }, { status: 403 });
  }

  const clientIp = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const rate = checkRateLimit(`audience_${clientIp}`, 60, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "模擬頻率過高，請稍候" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { conceptTitle, description, visualNotes, copyExcerpt, projectId, reverse } = body;
    if (!conceptTitle) {
      return NextResponse.json({ error: "概念標題為必填" }, { status: 400 });
    }

    const result = simulateAudienceReaction(
      conceptTitle,
      description || "",
      visualNotes || "",
      copyExcerpt || "",
      projectId
    );
    const prompt = `${conceptTitle} ${description || ""} ${copyExcerpt || ""}`;
    const reverseThinking =
      reverse === true || wantsReverseThinking(prompt)
        ? runReverseThinkingEvaluation({
            prompt,
            conceptTitle,
            description,
            visualNotes,
            copyExcerpt,
            projectId,
          })
        : null;

    return NextResponse.json({ ok: true, result, reverseThinking });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
