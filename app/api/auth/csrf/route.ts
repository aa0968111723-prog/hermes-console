import { NextResponse } from "next/server";
import { generateCsrfToken } from "@/lib/server/security";

export async function GET() {
  const token = generateCsrfToken();
  const response = NextResponse.json({
    ok: true,
    csrfToken: token
  });

  // 設定 HttpOnly / SameSite Lax Cookie
  response.cookies.set("csrf_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 86400 // 24 小時
  });

  return response;
}
