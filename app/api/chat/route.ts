import { NextRequest } from "next/server";
import { normalizeBaseUrl } from "@/lib/hermes-config";
import { verifySameOrigin, checkRateLimit, validateSsrfSafeUrl } from "@/lib/server/security";
import { streamHermesChat } from "@/lib/server/hermes";

export async function POST(req: NextRequest) {
  // 1. 同源寫入防護
  const originCheck = verifySameOrigin(req);
  if (!originCheck.ok) {
    return Response.json({ error: originCheck.reason || "無效的跨來源請求" }, { status: 403 });
  }

  // 2. 速率限制防護
  const clientIp = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const rate = checkRateLimit(`chat_${clientIp}`, 120, 60000);
  if (!rate.allowed) {
    return Response.json({ error: "請求過於頻繁，請稍候再試" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawUrl = body.baseUrl || process.env.HERMES_API_URL || "";
    const base = normalizeBaseUrl(rawUrl);

    // 3. SSRF 檢驗
    if (base) {
      const ssrf = validateSsrfSafeUrl(base, true);
      if (!ssrf.safe) {
        return Response.json({ error: `拒絕連線至不安全位址: ${ssrf.reason}` }, { status: 400 });
      }
    }

    const sessionKey = req.headers.get("x-hermes-session-key") || body.sessionKey || `project:${body.activeProject || "tku-zen-agent"}`;

    const chatStream = streamHermesChat({
      messages: Array.isArray(body.messages) ? body.messages : [],
      profileId: body.profileId || "tku",
      sessionKey,
      activeProject: body.activeProject || "tku-zen-agent",
      baseUrl: base,
      apiKey: body.apiKey,
      model: body.model,
      forceLocal: Boolean(body.forceLocal)
    });

    const stream = new ReadableStream({
      async pull(controller) {
        const { value, done } = await chatStream.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(new TextEncoder().encode(value));
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Hermes-Session-Key": sessionKey
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
