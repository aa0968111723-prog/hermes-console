import { NextRequest } from "next/server";

function normalizeBase(raw: string) {
  return String(raw || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/\/v1\/chat\/completions$/i, "")
    .replace(/\/v1$/i, "");
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const base = normalizeBase(body.baseUrl || process.env.HERMES_API_URL || "");
  const key = body.apiKey || process.env.HERMES_API_KEY || "";
  if (!base || !key) {
    return Response.json({ error: "缺少 Hermes API 網域或 Key。請先到設定頁填寫。" }, { status: 400 });
  }
  const upstream = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: body.model || "hermes-agent",
      stream: true,
      messages: body.messages || []
    })
  });
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return Response.json({ error: text || `Hermes 回傳 ${upstream.status}` }, { status: upstream.status || 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache"
    }
  });
}
