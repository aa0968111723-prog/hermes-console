import { NextResponse } from "next/server";
import { getWorkspaceCanvaToken } from "@/lib/server/canva-auth";

export async function GET() {
  const token = getWorkspaceCanvaToken();
  if (!token) {
    return NextResponse.json({
      connected: false,
      status: "未授權",
      message: "Canva 尚未連接，可點擊進行 PKCE 授權或使用沙盒模擬模式"
    });
  }

  return NextResponse.json({
    connected: true,
    isMock: Boolean(token.isMock),
    scope: token.scope,
    expiresIn: Math.max(0, Math.floor((token.obtainedAt + token.expiresIn * 1000 - Date.now()) / 1000)),
    status: token.isMock ? "沙盒模擬連線" : "已連接 Canva 正式版"
  });
}
