"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type FieldStatus = {
  configured: boolean;
  last4: string | null;
  source: "vault" | "env" | "none";
  value?: string;
};

type SettingsPayload = {
  vault: { ready: boolean; source: string };
  fields: Record<string, FieldStatus>;
  hermes: {
    configured: boolean;
    urlSource: string;
    keySource: string;
  };
  mcpBridge: FieldStatus;
  tamkang: {
    state: string;
    detail: string;
    urlSource: string;
    tokenSource: string;
  };
  xunhe?: {
    id?: string;
    name?: string;
    state: string;
    detail: string;
    configured?: boolean;
    urlSource: string;
    tokenSource: string;
  };
  atlas?: {
    configured: boolean;
    urlSource: string;
    tokenSource: string;
  };
  lumen?: {
    id?: string;
    name?: string;
    state: string;
    detail: string;
    configured?: boolean;
    urlSource: string;
    tokenSource: string;
  };
  framelab?: {
    id?: string;
    name?: string;
    state: string;
    detail: string;
    configured?: boolean;
    urlSource: string;
    tokenSource: string;
  };
  zeabur?: {
    token: FieldStatus;
    projectId: string;
    serviceId: string;
    environmentId: string;
    notice: string;
  };
  openSettingsWarning: string;
  probe?: { status: string; toolsCount: number; lastError: string | null };
};

const SOURCE: Record<string, string> = {
  vault: "工作區儲存",
  env: "環境變數",
  none: "尚未設定",
  file: "資料目錄金鑰",
  generated: "一次性啟動金鑰",
};

const TAMKANG: Record<string, string> = {
  unconfigured: "未設定",
  awaiting_authorization: "待驗證",
  available: "可用",
  partial: "部分可用",
  failed: "失敗",
  connected: "已連線",
  verified: "已驗證",
};

function secretHint(field?: FieldStatus) {
  if (!field?.configured) return "尚未儲存";
  return (
    (SOURCE[field.source] || field.source) +
    (field.last4 ? ` · 末四碼 ${field.last4}` : "")
  );
}

export default function ConnectionSettings({
  onChanged,
}: {
  onChanged?: () => Promise<void> | void;
}) {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [hermesUrl, setHermesUrl] = useState("");
  const [hermesKey, setHermesKey] = useState("");
  const [hermesModel, setHermesModel] = useState("");
  const [mcpToken, setMcpToken] = useState("");
  const [mcpJson, setMcpJson] = useState("");
  const [tkuUrl, setTkuUrl] = useState("");
  const [tkuToken, setTkuToken] = useState("");
  const [xunheUrl, setXunheUrl] = useState("");
  const [xunheToken, setXunheToken] = useState("");
  const [atlasUrl, setAtlasUrl] = useState("");
  const [atlasToken, setAtlasToken] = useState("");
  const [lumenUrl, setLumenUrl] = useState("");
  const [lumenToken, setLumenToken] = useState("");
  const [framelabUrl, setFramelabUrl] = useState("");
  const [framelabToken, setFramelabToken] = useState("");
  const [tkuUser, setTkuUser] = useState("");
  const [tkuPassword, setTkuPassword] = useState("");
  const [zeaburToken, setZeaburToken] = useState("");
  const [zeaburProject, setZeaburProject] = useState("");
  const [zeaburService, setZeaburService] = useState("");
  const [zeaburEnv, setZeaburEnv] = useState("");
  const [zeaburKey, setZeaburKey] = useState("");
  const [zeaburValue, setZeaburValue] = useState("");
  const [clearKeys, setClearKeys] = useState<string[]>([]);

  const apply = useCallback((next: SettingsPayload) => {
    setData(next);
    setHermesUrl(next.fields.HERMES_API_URL?.value || "");
    setHermesModel(next.fields.HERMES_MODEL?.value || "");
    setMcpJson(next.fields.CONSOLE_MCP_SERVERS_JSON?.value || "");
    setTkuUrl(next.fields.TKU_MCP_URL?.value || "");
    setXunheUrl(next.fields.XUNHE_MCP_URL?.value || "");
    setAtlasUrl(next.fields.ATLAS_MCP_URL?.value || "");
    setLumenUrl(next.fields.LUMEN_MCP_URL?.value || "");
    setFramelabUrl(next.fields.FRAMELAB_MCP_URL?.value || "");
    setZeaburProject(
      next.fields.ZEABUR_PROJECT_ID?.value || next.zeabur?.projectId || "",
    );
    setZeaburService(
      next.fields.ZEABUR_SERVICE_ID?.value || next.zeabur?.serviceId || "",
    );
    setZeaburEnv(
      next.fields.ZEABUR_ENVIRONMENT_ID?.value ||
        next.zeabur?.environmentId ||
        "",
    );
    setHermesKey("");
    setMcpToken("");
    setTkuToken("");
    setXunheToken("");
    setAtlasToken("");
    setLumenToken("");
    setFramelabToken("");
    setTkuPassword("");
    setZeaburToken("");
    setZeaburValue("");
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/credentials", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body.error?.message || "無法讀取連線設定。");
    apply(body as SettingsPayload);
  }, [apply]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  function toggleClear(name: string, checked: boolean) {
    setClearKeys((current) =>
      checked
        ? [...new Set([...current, name])]
        : current.filter((item) => item !== name),
    );
  }

  async function postJson(path: string, body: unknown) {
    const response = await fetch("/api/" + path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error?.message || "操作失敗，請稍後重試。");
    return data;
  }

  async function afterSave(next: SettingsPayload, message: string) {
    apply(next);
    setClearKeys([]);
    setNotice(message);
    await onChanged?.();
    document.querySelector(".credential-warning")?.scrollIntoView({
      block: "start",
      behavior: "auto",
    });
  }

  return (
    <div className="settings-stack credential-settings">
      <p className="credential-warning">{data?.openSettingsWarning}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p className="muted">{notice}</p>}
      <p className="muted">
        金鑰只送到後端加密保存，不會寫進前端程式。讀取時只顯示是否已設定與末四碼。
        環境變數仍可作為後備；工作區儲存優先。
      </p>
      <dl className="facts">
        <dt>秘密儲存</dt>
        <dd>
          {data
            ? SOURCE[data.vault.source] || data.vault.source
            : "讀取中"}
        </dd>
        <dt>Hermes</dt>
        <dd>
          {data?.hermes.configured
            ? `已設定（網址 ${SOURCE[data.hermes.urlSource]}／金鑰 ${SOURCE[data.hermes.keySource]}）`
            : "尚未設定"}
        </dd>
        <dt>淡江 MCP</dt>
        <dd>
          {data
            ? `${TAMKANG[data.tamkang.state] || data.tamkang.state} · ${data.tamkang.detail}`
            : "讀取中"}
        </dd>
        <dt>訊核 MCP</dt>
        <dd>
          {data?.xunhe
            ? `${TAMKANG[data.xunhe.state] || data.xunhe.state} · ${data.xunhe.detail}`
            : "尚未設定"}
        </dd>
        <dt>場圖 Atlas</dt>
        <dd>
          {data?.atlas?.configured
            ? `已設定（網址 ${SOURCE[data.atlas.urlSource]}／權杖 ${SOURCE[data.atlas.tokenSource]}）`
            : "尚未設定"}
        </dd>
        <dt>Lumen 創作台</dt>
        <dd>
          {data?.lumen
            ? `${TAMKANG[data.lumen.state] || data.lumen.state} · ${data.lumen.detail}`
            : "尚未設定"}
        </dd>
        <dt>FrameLab MCP</dt>
        <dd>
          {data?.framelab
            ? `${TAMKANG[data.framelab.state] || data.framelab.state} · ${data.framelab.detail}`
            : "尚未設定"}
        </dd>
      </dl>

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const payload: Record<string, unknown> = {
              HERMES_API_URL: hermesUrl,
              HERMES_MODEL: hermesModel,
              CONSOLE_MCP_SERVERS_JSON: mcpJson,
              TKU_MCP_URL: tkuUrl,
              XUNHE_MCP_URL: xunheUrl,
              ATLAS_MCP_URL: atlasUrl,
              LUMEN_MCP_URL: lumenUrl,
              FRAMELAB_MCP_URL: framelabUrl,
              ZEABUR_PROJECT_ID: zeaburProject,
              ZEABUR_SERVICE_ID: zeaburService,
              ZEABUR_ENVIRONMENT_ID: zeaburEnv,
            };
            if (hermesKey) payload.HERMES_API_KEY = hermesKey;
            if (mcpToken) payload.MCP_BRIDGE_TOKEN = mcpToken;
            if (tkuToken) payload.TKU_MCP_TOKEN = tkuToken;
            if (xunheToken) payload.XUNHE_MCP_TOKEN = xunheToken;
            if (atlasToken) payload.ATLAS_MCP_TOKEN = atlasToken;
            if (lumenToken) payload.LUMEN_MCP_TOKEN = lumenToken;
            if (framelabToken) payload.FRAMELAB_MCP_TOKEN = framelabToken;
            if (zeaburToken) payload.ZEABUR_API_TOKEN = zeaburToken;
            if (clearKeys.length) payload.clear = clearKeys;
            const saved = (await postJson(
              "settings/credentials",
              payload,
            )) as SettingsPayload;
            await afterSave(saved, "連線設定已保存。");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>Hermes 憑證</h3>
        <label>
          Hermes API 網址
          <input
            value={hermesUrl}
            onChange={(e) => setHermesUrl(e.target.value)}
            placeholder="https://your-hermes.example"
            autoComplete="off"
            inputMode="url"
          />
        </label>
        <label>
          Hermes API 金鑰
          <span className="secret-hint">
            {secretHint(data?.fields.HERMES_API_KEY)}
          </span>
          <input
            type="password"
            value={hermesKey}
            onChange={(e) => setHermesKey(e.target.value)}
            placeholder="貼上新金鑰後儲存"
            autoComplete="off"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={clearKeys.includes("HERMES_API_KEY")}
            onChange={(e) => toggleClear("HERMES_API_KEY", e.target.checked)}
          />
          清除已存 Hermes 金鑰
        </label>
        <label>
          選用模型
          <input
            value={hermesModel}
            onChange={(e) => setHermesModel(e.target.value)}
            placeholder="hermes-agent"
            autoComplete="off"
          />
        </label>

        <h3>Workspace MCP 橋接</h3>
        <label>
          MCP 橋接權杖
          <span className="secret-hint">{secretHint(data?.mcpBridge)}</span>
          <input
            type="password"
            value={mcpToken}
            onChange={(e) => setMcpToken(e.target.value)}
            placeholder="至少 32 個字元"
            autoComplete="off"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={clearKeys.includes("MCP_BRIDGE_TOKEN")}
            onChange={(e) => toggleClear("MCP_BRIDGE_TOKEN", e.target.checked)}
          />
          清除已存橋接權杖
        </label>
        <label>
          核准 MCP 清單（JSON）
          <textarea
            rows={5}
            value={mcpJson}
            onChange={(e) => setMcpJson(e.target.value)}
            placeholder='[{"id":"example","name":"範例","endpoint":"https://example.invalid/mcp","credentialReference":null,"readonly":true}]'
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p className="muted">
          JSON 只放端點與憑證變數名稱，不要把權杖寫進清單。場圖、Lumen、FrameLab、淡江與訊核可用下方專用欄位。
        </p>

        <h3>場圖 Atlas MCP</h3>
        <p className="muted">
          端點必須是公開 HTTPS，路徑為 /api/mcp，不可用 localhost 或 GitHub 網址。
          權杖與場圖後端 ATLAS_MCP_TOKEN 相同。儲存後按「測試場圖連線」，Hermes 即可呼叫 mcp.atlas.*。
        </p>
        <label>
          場圖 MCP 網址
          <input
            value={atlasUrl}
            onChange={(e) => setAtlasUrl(e.target.value)}
            placeholder="https://your-atlas.example/api/mcp"
            autoComplete="off"
            inputMode="url"
          />
        </label>
        <label>
          場圖 MCP 權杖
          <span className="secret-hint">
            {secretHint(data?.fields.ATLAS_MCP_TOKEN)}
          </span>
          <input
            type="password"
            value={atlasToken}
            onChange={(e) => setAtlasToken(e.target.value)}
            placeholder="與場圖後端 ATLAS_MCP_TOKEN 相同"
            autoComplete="off"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={clearKeys.includes("ATLAS_MCP_TOKEN")}
            onChange={(e) => toggleClear("ATLAS_MCP_TOKEN", e.target.checked)}
          />
          清除已存場圖權杖
        </label>

        <h3>FrameLab 動畫 MCP</h3>
        <p className="muted">
          端點必須是公開 HTTPS，路徑為 /api/mcp，不可用 GitHub 倉庫網址。
          權杖從 FrameLab 首頁「產生連線權杖」複製，開頭為 fl_。儲存後按「測試 FrameLab 連線」，Hermes 即可呼叫 mcp.framelab.* 與 framelab_*。
        </p>
        <label>
          FrameLab MCP 網址
          <input
            value={framelabUrl}
            onChange={(e) => setFramelabUrl(e.target.value)}
            placeholder="https://your-framelab.example/api/mcp"
            autoComplete="off"
            inputMode="url"
          />
        </label>
        <label>
          FrameLab MCP 權杖
          <span className="secret-hint">
            {secretHint(data?.fields.FRAMELAB_MCP_TOKEN)}
          </span>
          <input
            type="password"
            value={framelabToken}
            onChange={(e) => setFramelabToken(e.target.value)}
            placeholder="從 FrameLab 首頁複製 fl_ 權杖"
            autoComplete="off"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={clearKeys.includes("FRAMELAB_MCP_TOKEN")}
            onChange={(e) => toggleClear("FRAMELAB_MCP_TOKEN", e.target.checked)}
          />
          清除已存 FrameLab 權杖
        </label>

        <h3>Lumen 創作台</h3>
        <p className="muted">
          填 Lumen 的 Streamable HTTP 端點（路徑 /api/mcp）。不能填 GitHub 倉庫網址。權杖至少 32 字元，與 Lumen 首頁複製的 LUMEN_MCP_TOKEN 相同。網址與權杖都存好後 Hermes 即可經 Workspace MCP 呼叫 lumen_utter；按「測試 Lumen 連線」確認 initialize／tools/list。選定方向留給使用者，不要呼叫 choose。
        </p>
        <label>
          Lumen MCP 網址
          <input
            value={lumenUrl}
            onChange={(e) => setLumenUrl(e.target.value)}
            placeholder="https://your-lumen.example/api/mcp"
            autoComplete="off"
            inputMode="url"
          />
        </label>
        <label>
          Lumen MCP 權杖
          <span className="secret-hint">
            {secretHint(data?.fields.LUMEN_MCP_TOKEN)}
          </span>
          <input
            type="password"
            value={lumenToken}
            onChange={(e) => setLumenToken(e.target.value)}
            placeholder="與 Lumen 後端 LUMEN_MCP_TOKEN 相同"
            autoComplete="off"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={clearKeys.includes("LUMEN_MCP_TOKEN")}
            onChange={(e) => toggleClear("LUMEN_MCP_TOKEN", e.target.checked)}
          />
          清除已存 Lumen 權杖
        </label>

        <h3>訊核即時情報 MCP</h3>
        <p className="muted">
          填訊核的 Streamable HTTP 端點（路徑 /mcp 或 /api/mcp）。不能填 GitHub 倉庫網址。儲存後按「測試訊核連線」，成功才代表 Hermes 能呼叫 xunhe_research。
        </p>
        <label>
          訊核 MCP 網址
          <input
            value={xunheUrl}
            onChange={(e) => setXunheUrl(e.target.value)}
            placeholder="https://your-xunhe.example/mcp"
            autoComplete="off"
            inputMode="url"
          />
        </label>
        <label>
          訊核 MCP 權杖（選用）
          <span className="secret-hint">
            {secretHint(data?.fields.XUNHE_MCP_TOKEN)}
          </span>
          <input
            type="password"
            value={xunheToken}
            onChange={(e) => setXunheToken(e.target.value)}
            placeholder="與訊核後端 XUNHE_MCP_TOKEN 相同"
            autoComplete="off"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={clearKeys.includes("XUNHE_MCP_TOKEN")}
            onChange={(e) => toggleClear("XUNHE_MCP_TOKEN", e.target.checked)}
          />
          清除已存訊核權杖
        </label>

        <h3>淡江 MCP</h3>
        <label>
          淡江 MCP 網址
          <input
            value={tkuUrl}
            onChange={(e) => setTkuUrl(e.target.value)}
            placeholder="https://tku-mcp.example/mcp"
            autoComplete="off"
            inputMode="url"
          />
        </label>
        <label>
          淡江 MCP 權杖
          <span className="secret-hint">
            {secretHint(data?.fields.TKU_MCP_TOKEN)}
          </span>
          <input
            type="password"
            value={tkuToken}
            onChange={(e) => setTkuToken(e.target.value)}
            placeholder="貼上 Bearer 權杖後儲存"
            autoComplete="off"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={clearKeys.includes("TKU_MCP_TOKEN")}
            onChange={(e) => toggleClear("TKU_MCP_TOKEN", e.target.checked)}
          />
          清除已存淡江權杖
        </label>
        <label>
          淡江使用者名稱（選用）
          <input
            value={tkuUser}
            onChange={(e) => setTkuUser(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          淡江密碼（選用）
          <input
            type="password"
            value={tkuPassword}
            onChange={(e) => setTkuPassword(e.target.value)}
            autoComplete="off"
          />
        </label>
        <p className="muted">
          既有實作以網址加 Bearer 權杖為準。若伺服器在同一來源提供
          /auth/login、/api/auth/login、/login 或 JSON-RPC auth/login，後端會代為交換權杖；沒有這些端點時請直接貼權杖。
        </p>

        <h3>Zeabur 部署</h3>
        <p className="muted">
          {data?.zeabur?.notice ||
            "在 Zeabur 控制台 Settings → API Keys 建立權杖。公開站任何人都可以覆寫並變更後端環境變數。"}
        </p>
        <label>
          Zeabur API 權杖
          <span className="secret-hint">
            {secretHint(data?.fields.ZEABUR_API_TOKEN || data?.zeabur?.token)}
          </span>
          <input
            type="password"
            value={zeaburToken}
            onChange={(e) => setZeaburToken(e.target.value)}
            placeholder="貼上後儲存"
            autoComplete="off"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={clearKeys.includes("ZEABUR_API_TOKEN")}
            onChange={(e) => toggleClear("ZEABUR_API_TOKEN", e.target.checked)}
          />
          清除已存 Zeabur 權杖
        </label>
        <label>
          專案識別
          <input
            value={zeaburProject}
            onChange={(e) => setZeaburProject(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          服務識別
          <input
            value={zeaburService}
            onChange={(e) => setZeaburService(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          環境識別
          <input
            value={zeaburEnv}
            onChange={(e) => setZeaburEnv(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          寫入單一環境變數（選用）
          <input
            value={zeaburKey}
            onChange={(e) => setZeaburKey(e.target.value)}
            placeholder="HERMES_API_KEY"
            autoComplete="off"
          />
        </label>
        <label>
          變數值
          <input
            type="password"
            value={zeaburValue}
            onChange={(e) => setZeaburValue(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="credential-actions">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const result = (await postJson("settings/zeabur", {
                  action: "test",
                })) as { identity?: string };
                setNotice("Zeabur：" + (result.identity || "已連線"));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            測試 Zeabur
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const result = (await postJson("settings/zeabur", {
                  action: "push_console_keys",
                })) as { updated?: string[] };
                setNotice(
                  "已推送到 Zeabur：" + (result.updated || []).join("、"),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            推送 Console 金鑰
          </button>
          <button
            type="button"
            disabled={busy || !zeaburKey || !zeaburValue}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                await postJson("settings/zeabur", {
                  action: "update_env",
                  variables: [{ key: zeaburKey, value: zeaburValue }],
                });
                setZeaburValue("");
                setNotice("已更新 Zeabur 環境變數 " + zeaburKey);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            寫入變數
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const result = (await postJson("settings/zeabur", {
                  action: "redeploy",
                })) as { status?: string };
                setNotice("已要求重新部署：" + (result.status || "已送出"));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            重新部署
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                await postJson("settings/zeabur", { action: "restart" });
                setNotice("已要求重啟服務。");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            重啟服務
          </button>
        </div>

        <div className="credential-actions">
          <button type="submit" disabled={busy}>
            {busy ? "處理中…" : "儲存連線設定"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const result = (await postJson("settings/tamkang", {
                  action: "test",
                })) as SettingsPayload;
                await afterSave(
                  result,
                  result.probe
                    ? `淡江探測：${TAMKANG[result.probe.status] || result.probe.status}，工具 ${result.probe.toolsCount} 項。`
                    : "已完成淡江連線測試。",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={16} />
            測試淡江連線
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const result = (await postJson("settings/xunhe", {
                  action: "test",
                })) as SettingsPayload;
                await afterSave(
                  result,
                  result.probe
                    ? `訊核探測：${TAMKANG[result.probe.status] || result.probe.status}，工具 ${result.probe.toolsCount} 項。`
                    : "已完成訊核連線測試。",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={16} />
            測試訊核連線
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const result = (await postJson("settings/atlas", {
                  action: "test",
                })) as SettingsPayload;
                await afterSave(
                  result,
                  result.probe
                    ? `場圖探測：${TAMKANG[result.probe.status] || result.probe.status}，工具 ${result.probe.toolsCount} 項。`
                    : "已完成場圖連線測試。",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={16} />
            測試場圖連線
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const result = (await postJson("settings/lumen", {
                  action: "test",
                })) as SettingsPayload;
                await afterSave(
                  result,
                  result.probe
                    ? `Lumen 探測：${TAMKANG[result.probe.status] || result.probe.status}，工具 ${result.probe.toolsCount} 項。`
                    : "已完成 Lumen 連線測試。",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={16} />
            測試 Lumen 連線
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const result = (await postJson("settings/framelab", {
                  action: "test",
                })) as SettingsPayload;
                await afterSave(
                  result,
                  result.probe
                    ? `FrameLab 探測：${TAMKANG[result.probe.status] || result.probe.status}，工具 ${result.probe.toolsCount} 項。`
                    : "已完成 FrameLab 連線測試。",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={16} />
            測試 FrameLab 連線
          </button>
          <button
            type="button"
            disabled={busy || !tkuUser || !tkuPassword}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const result = (await postJson("settings/tamkang", {
                  action: "login",
                  username: tkuUser,
                  password: tkuPassword,
                })) as SettingsPayload;
                setTkuUser("");
                await afterSave(result, "已用校園憑證交換權杖並探測連線。");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            以校園憑證交換權杖
          </button>
        </div>
      </form>
    </div>
  );
}
