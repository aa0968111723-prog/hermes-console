import assert from "node:assert";
import {
  generateCsrfToken,
  verifySameOrigin,
  validateSsrfSafeUrl,
  checkRateLimit
} from "../lib/server/security.ts";
import {
  buildCanvaAuthorizationUrl,
  setWorkspaceCanvaToken,
  getWorkspaceCanvaToken
} from "../lib/server/canva-auth.ts";

console.log("🚀 開始執行 Phase 1 安全性與零登入工作區單元測試...\n");

// 1. CSRF Token 測試
console.log("▶ 測試 1: CSRF Token 產生");
const csrf = generateCsrfToken();
assert.strictEqual(typeof csrf, "string", "CSRF token 應為字串");
assert.strictEqual(csrf.length, 48, "CSRF token 長度應為 48 16進位字元 (24 bytes)");
console.log("  ✓ CSRF Token 產生通過:", csrf.slice(0, 12) + "...");

// 2. 同源寫入保護測試
console.log("▶ 測試 2: 同源寫入保護 (Same-Origin Check)");
// 模擬 NextRequest headers
function createMockRequest(headers: Record<string, string>, method: string = "POST") {
  return {
    method,
    headers: {
      get: (k: string) => headers[k.toLowerCase()] || null
    }
  } as any;
}

const sameOriginReq = createMockRequest({
  origin: "https://my-hermes.zeabur.app",
  host: "my-hermes.zeabur.app"
});
assert.strictEqual(verifySameOrigin(sameOriginReq).ok, true, "同源請求應通過");

const localhostReq = createMockRequest({
  origin: "http://localhost:3000",
  host: "localhost:3000"
});
assert.strictEqual(verifySameOrigin(localhostReq).ok, true, "Localhost 請求應通過");

const attackerReq = createMockRequest({
  origin: "https://evil-hacker.com",
  host: "my-hermes.zeabur.app"
});
const attackerRes = verifySameOrigin(attackerReq);
assert.strictEqual(attackerRes.ok, false, "跨站偽造請求應被拒絕");
console.log("  ✓ 同源驗證通過，成功阻擋惡意跨站來源");

// 3. SSRF 安全防護測試
console.log("▶ 測試 3: SSRF 防護檢查");
const safeUrl = validateSsrfSafeUrl("https://hermes-agent-api.zeabur.app");
assert.strictEqual(safeUrl.safe, true, "正常的公開 HTTPS 網址應通過");

const dangerousMetadata = validateSsrfSafeUrl("http://169.254.169.254/latest/meta-data/");
assert.strictEqual(dangerousMetadata.safe, false, "雲端 Metadata 服務必須被阻擋");

const dangerousProtocol = validateSsrfSafeUrl("file:///etc/passwd");
assert.strictEqual(dangerousProtocol.safe, false, "非 HTTP/HTTPS 協議必須被阻擋");

const dangerousZero = validateSsrfSafeUrl("http://0.0.0.0:8080");
assert.strictEqual(dangerousZero.safe, false, "0.0.0.0 特殊綁定地址必須被阻擋");

const dangerousPrivateIp = validateSsrfSafeUrl("http://192.168.1.100/admin");
assert.strictEqual(dangerousPrivateIp.safe, false, "未授權之內部私有網段必須被阻擋");
console.log("  ✓ SSRF 防護檢查通過 (含 0.0.0.0 與私有 IP)");

// 4. 速率限制測試
console.log("▶ 測試 4: 記憶體速率限制");
const testIp = "test-rate-limit-ip-" + Date.now();
for (let i = 0; i < 5; i++) {
  const r = checkRateLimit(testIp, 5, 10000);
  assert.strictEqual(r.allowed, true, `第 ${i+1} 次請求應允許`);
}
const blocked = checkRateLimit(testIp, 5, 10000);
assert.strictEqual(blocked.allowed, false, "超過上限應被限制");
console.log("  ✓ 速率限制器正常工作");

// 5. Canva PKCE 與獨立狀態 Cookie 測試
console.log("▶ 測試 5: Canva PKCE 授權與零登入工作區 Token 管理");
const authData = buildCanvaAuthorizationUrl("http://localhost:3000/api/auth/canva/callback");
assert.ok(authData.authorizationUrl.includes("code_challenge="), "應包含 PKCE code_challenge");
assert.ok(authData.authorizationUrl.includes("response_type=code"), "應為 authorization_code 模式");
assert.strictEqual(typeof authData.verifier, "string", "應產生 PKCE code_verifier");
assert.strictEqual(typeof authData.state, "string", "應產生安全隨機 state");

// 測試 Token 設定與讀取
setWorkspaceCanvaToken({
  accessToken: "test_workspace_token_abc",
  expiresIn: 3600,
  obtainedAt: Date.now(),
  scope: "design:content:read design:content:write",
  isMock: true
});
const currentToken = getWorkspaceCanvaToken();
assert.ok(currentToken, "工作區應能取得 Token");
assert.strictEqual(currentToken.accessToken, "test_workspace_token_abc");
assert.strictEqual(currentToken.isMock, true);

// 測試非 Mock Token 寫入與 Vault 連動
process.env.CONSOLE_VAULT_KEY = process.env.CONSOLE_VAULT_KEY || "0123456789abcdef0123456789abcdef";
setWorkspaceCanvaToken({
  accessToken: "vault_synced_token_xyz",
  refreshToken: "vault_refresh_xyz",
  expiresIn: 7200,
  obtainedAt: Date.now(),
  scope: "design:content:read",
  isMock: false
});
const syncedToken = getWorkspaceCanvaToken();
assert.strictEqual(syncedToken?.accessToken, "vault_synced_token_xyz");
assert.strictEqual(syncedToken?.isMock, false);
console.log("  ✓ Canva PKCE 與零登入工作區管理測試通過 (含 Vault 持久化雙向同步)");

console.log("\n🎉 Phase 1 全部 5 項核心安全性與工作區測試 100% 通過！");
