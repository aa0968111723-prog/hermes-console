import { NextRequest, NextResponse } from "next/server";
import { buildCanvaAuthorizationUrl } from "@/lib/server/canva-auth";

export async function GET(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const protocol = req.headers.get("x-forwarded-proto") || "http";
  const redirectUri = `${protocol}://${host}/api/auth/canva/callback`;

  const { authorizationUrl, state, verifier, isDemo } = buildCanvaAuthorizationUrl(redirectUri);

  // 如果是在開發/展示模式且未配置 Canva Client ID，允許快速模擬連線
  const url = new URL(req.url);
  const mockConnect = url.searchParams.get("mock") === "true";

  if (mockConnect || isDemo) {
    // 導向帶有 mock=1 的回調以模擬連線完成
    const mockRedirect = NextResponse.redirect(new URL(`/api/auth/canva/callback?mock=true&state=${state}`, req.url));
    mockRedirect.cookies.set("canva_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600
    });
    mockRedirect.cookies.set("canva_code_verifier", verifier, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600
    });
    return mockRedirect;
  }

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set("canva_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600
  });
  response.cookies.set("canva_code_verifier", verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600
  });

  return response;
}
