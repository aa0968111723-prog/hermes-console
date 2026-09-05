import { NextRequest } from "next/server";
import { executeHermesTool } from "@/lib/tools";
import { verifySameOrigin, checkRateLimit } from "@/lib/server/security";

export async function POST(req: NextRequest) {
  // 1. 同源防護檢驗
  const originCheck = verifySameOrigin(req);
  if (!originCheck.ok) {
    return Response.json({ error: originCheck.reason || "無效的跨來源請求" }, { status: 403 });
  }

  // 2. 簡易速率限制防護
  const clientIp = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const rate = checkRateLimit(`tool_${clientIp}`, 60, 60000);
  if (!rate.allowed) {
    return Response.json({ error: "請求過於頻繁，請稍候再試" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { name, args } = body;
    if (!name) {
      return Response.json({ error: "缺少工具名稱" }, { status: 400 });
    }
    const result = await executeHermesTool(name, args || {});
    return Response.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
