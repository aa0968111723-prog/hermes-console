import { NextRequest, NextResponse } from "next/server";
import { CANVA_DEFAULT_CONFIG, setWorkspaceCanvaToken } from "@/lib/server/canva-auth";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const isMock = url.searchParams.get("mock") === "true";

  const savedState = req.cookies.get("canva_oauth_state")?.value;
  const verifier = req.cookies.get("canva_code_verifier")?.value;

  if (!state || (savedState && state !== savedState)) {
    return NextResponse.redirect(new URL("/?canva_error=state_mismatch", req.url));
  }

  // 1. 若為模擬或未配置真實 Client 模式
  if (isMock || !CANVA_DEFAULT_CONFIG.clientId) {
    setWorkspaceCanvaToken({
      accessToken: "mock_canva_token_" + Date.now(),
      expiresIn: 3600,
      obtainedAt: Date.now(),
      scope: CANVA_DEFAULT_CONFIG.scopes.join(" "),
      isMock: true
    });

    const response = NextResponse.redirect(new URL("/?canva=connected_sandbox", req.url));
    response.cookies.delete("canva_oauth_state");
    response.cookies.delete("canva_code_verifier");
    return response;
  }

  // 2. 真實 Canva OAuth Token 交換
  if (!code || !verifier) {
    return NextResponse.redirect(new URL("/?canva_error=missing_code", req.url));
  }

  try {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
    const protocol = req.headers.get("x-forwarded-proto") || "http";
    const redirectUri = `${protocol}://${host}/api/auth/canva/callback`;

    const tokenRes = await fetch(CANVA_DEFAULT_CONFIG.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${CANVA_DEFAULT_CONFIG.clientId}:${CANVA_DEFAULT_CONFIG.clientSecret}`
        ).toString("base64")}`
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier
      })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return NextResponse.redirect(
        new URL(`/?canva_error=${encodeURIComponent(errText.slice(0, 100))}`, req.url)
      );
    }

    const tokenData = await tokenRes.json();
    setWorkspaceCanvaToken({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in || 3600,
      obtainedAt: Date.now(),
      scope: tokenData.scope || CANVA_DEFAULT_CONFIG.scopes.join(" "),
      isMock: false
    });

    const response = NextResponse.redirect(new URL("/?canva=connected", req.url));
    response.cookies.delete("canva_oauth_state");
    response.cookies.delete("canva_code_verifier");
    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(new URL(`/?canva_error=${encodeURIComponent(msg)}`, req.url));
  }
}
