import { isAuthRequired } from "./mode";

function gatewayConfigured() {
  return (
    (process.env.CONSOLE_GATEWAY_SECRET || "").length >= 32 ||
    process.env.CONSOLE_REQUIRE_GATEWAY === "true"
  );
}

export function settingsAccessWarning() {
  if (isAuthRequired()) {
    return "僅工作區 owner／admin 可改連線。秘密只存在後端。";
  }
  if (gatewayConfigured()) {
    return "工作區模式。連線變更需通過部署閘道。";
  }
  return "此設定頁沒有邀請登入或閘道保護。能開啟網站的人都可以覆寫連線憑證與 Zeabur 部署。";
}

export function zeaburAccessNotice() {
  if (isAuthRequired()) {
    return "權杖在 Zeabur 控制台 Settings → API Keys 建立。僅 owner／admin 可改部署設定。";
  }
  if (gatewayConfigured()) {
    return "權杖在 Zeabur 控制台 Settings → API Keys 建立。變更需通過部署閘道。";
  }
  return "權杖在 Zeabur 控制台 Settings → API Keys 建立。能開啟此網站的人都可以覆寫權杖並變更部署環境變數。";
}
