import { NextResponse } from "next/server";
import { getWorkspaceCanvaToken } from "@/lib/server/canva-auth";
import { canvaStatus } from "@/lib/server/canva";
import { WORKSPACE_OWNER } from "@/lib/server/security";

export async function GET() {
  const token = getWorkspaceCanvaToken();
  const ownerStatus = canvaStatus(WORKSPACE_OWNER);

  if (ownerStatus.verifiedAt && (ownerStatus.state === "verified" || ownerStatus.state === "partial")) {
    return NextResponse.json({
      connected: true,
      isMock: false,
      status: ownerStatus.state === "verified" ? "已驗證在線" : "已驗證設計清單讀取",
      message: ownerStatus.message,
      verifiedAt: ownerStatus.verifiedAt,
      source: "vault"
    });
  }

  if (!token) {
    return NextResponse.json({
      connected: false,
      status: ownerStatus.needsAuthorization ? "等待授權" : "未授權",
      message: ownerStatus.needsAuthorization
        ? "已配置 Client ID，請完成 PKCE 授權。"
        : "Canva 尚未連接，可點擊進行 PKCE 授權或使用沙盒模擬模式"
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
