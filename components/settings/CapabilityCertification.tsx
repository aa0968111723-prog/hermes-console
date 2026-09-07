"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type CapabilityStatus =
  | "unknown"
  | "configured"
  | "reachable"
  | "authenticated"
  | "verified"
  | "partial"
  | "failed"
  | "unsupported";

type CertificationReport = {
  integrations: Array<{
    id: string;
    name: string;
    overall: CapabilityStatus;
    notice: string;
    capabilities: Array<{
      id: string;
      name: string;
      status: CapabilityStatus;
      message: string;
      latencyMs: number | null;
      evidence: { kind: string } | null;
    }>;
  }>;
};

const EVIDENCE: Record<string, string> = {
  LOCAL_UNIT: "本機單元",
  LOCAL_CONTRACT: "本機契約",
  LOCAL_BROWSER: "本機瀏覽器",
  LIVE_EXTERNAL: "外部實機",
  UNVERIFIED: "未驗證",
};

const STATUS: Record<CapabilityStatus, string> = {
  unknown: "未驗證",
  configured: "已設定",
  reachable: "可連線",
  authenticated: "已通過認證",
  verified: "已驗證",
  partial: "部分可用",
  failed: "失敗",
  unsupported: "不支援",
};

function statusLabel(status: CapabilityStatus) {
  return STATUS[status] || status;
}

export default function CapabilityCertification() {
  const [report, setReport] = useState<CertificationReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/certification", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error?.message || "無法讀取能力驗證。");
    setReport(body.report);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, [load]);

  return (
    <section className="capability-cert">
      <header>
        <div>
          <h3>能力驗證</h3>
          <p className="muted">
            Connected 不是可用。每個能力分開檢查。本機 mock 不會標成外部實機。
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const response = await fetch("/api/certification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "run" }),
              });
              const body = await response.json();
              if (!response.ok)
                throw new Error(body.error?.message || "能力驗證失敗。");
              setReport(body.report);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={16} />
          {busy ? "檢查中…" : "檢查能力"}
        </button>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {report?.integrations.map((item) => (
        <article key={item.id}>
          <h4>
            {item.name}
            <span data-status={item.overall as CapabilityStatus}>
              {statusLabel(item.overall)}
            </span>
          </h4>
          <p className="muted">{item.notice}</p>
          <ul>
            {item.capabilities.map((cap) => (
              <li key={cap.id}>
                <strong>{cap.name}</strong>
                <span data-status={cap.status}>{statusLabel(cap.status)}</span>
                <small>
                  {cap.evidence
                    ? EVIDENCE[cap.evidence.kind] || cap.evidence.kind
                    : "未驗證"}
                  {cap.latencyMs !== null ? ` · ${cap.latencyMs}ms` : ""}
                </small>
                <p>{cap.message}</p>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
