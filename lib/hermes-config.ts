/**
 * Hermes Agent 連線與設定配置
 * 支援 Zeabur 部署規格、預設金鑰與本機快取
 */

export const HERMES_DEFAULTS = {
  // Zeabur 部署預設 API Server Key
  DEFAULT_API_KEY: "Xn7KpRg8w2vr91aHdeWoIDmTf6Jx0354",
  // 儀表板帳號與密碼
  DASHBOARD_USER: "admin",
  DASHBOARD_PASS: "Xn7KpRg8w2vr91aHdeWoIDmTf6Jx0354",
  // 預設模型名稱
  DEFAULT_MODEL: "hermes-agent",
  // API Endpoint 規格
  CHAT_ENDPOINT: "/v1/chat/completions",
  MODELS_ENDPOINT: "/v1/models"
};

export const STORAGE_KEYS = {
  API_URL: "hermes.apiUrl",
  API_KEY: "hermes.apiKey",
  MODEL: "hermes.model",
  ACTIVE_PROJECT: "hermes.activeProject",
  CONVERSATIONS: "hermes.conversations",
  ACTIVE_CONV_ID: "hermes.activeConvId",
  VIEW_MODE: "hermes.viewMode", // 'console' | 'jieworld'
  JIE_FACE: "jie.face"
};

/**
 * 標準化 Hermes 基礎 API 網域
 */
export function normalizeBaseUrl(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/\/v1\/chat\/completions$/i, "")
    .replace(/\/v1\/models$/i, "")
    .replace(/\/v1$/i, "");
}
