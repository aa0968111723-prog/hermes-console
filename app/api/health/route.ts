import { NextRequest } from "next/server";
import { normalizeBaseUrl, HERMES_DEFAULTS } from "@/lib/hermes-config";
import { checkRateLimit, validateSsrfSafeUrl } from "@/lib/server/security";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const clientIp = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const rate = checkRateLimit(`health_${clientIp}`, 60, 60000);
  if (!rate.allowed) {
    return Response.json({ ok: false, error: "請求過於頻繁" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawUrl = body.baseUrl || process.env.HERMES_API_URL || "";
    const base = normalizeBaseUrl(rawUrl);

    if (!base) {
      return Response.json({ ok: false, error: "未提供 Zeabur 網域" }, { status: 400 });
    }

    const ssrf = validateSsrfSafeUrl(base, true);
    if (!ssrf.safe) {
      return Response.json({ ok: false, error: `不安全的目標網址: ${ssrf.reason}` }, { status: 400 });
    }

    const key = (body.apiKey || process.env.HERMES_API_KEY || HERMES_DEFAULTS.DEFAULT_API_KEY).trim();

    // 測試連線
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${base}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`
      },
      signal: controller.signal
    }).catch(() => null);

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (res && res.ok) {
      const data = await res.json().catch(() => ({}));
      return Response.json({
        ok: true,
        latencyMs,
        models: data.data?.map((m: { id: string }) => m.id) || [HERMES_DEFAULTS.DEFAULT_MODEL],
        statusText: "連線正常"
      });
    }

    // 若 /v1/models 未開，嘗試 ping 根路徑或回傳基本檢驗
    const pingRes = await fetch(`${base}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` }
    }).catch(() => null);

    if (pingRes && (pingRes.ok || pingRes.status === 401 || pingRes.status === 404)) {
      return Response.json({
        ok: true,
        latencyMs: Date.now() - start,
        models: [HERMES_DEFAULTS.DEFAULT_MODEL],
        statusText: `伺服器已回應 (HTTP ${pingRes.status})`
      });
    }

    return Response.json({
      ok: false,
      latencyMs: Date.now() - start,
      error: "無法連線至 Hermes API，請確認 Zeabur 網域已正確綁定並可自外部訪問。"
    }, { status: 502 });
  } catch (e: unknown) {
    return Response.json({
      ok: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e)
    }, { status: 500 });
  }
}
