import type { Health } from "@/lib/contracts";

export default function VisualStatus({ health, offline }: { health?: Health | null; offline: boolean }) {
  const status = offline ? "offline" : health?.status || "unknown";
  const label = offline ? "離線" : status === "available" ? "已連線" : status === "failed" ? "連線失敗" : status === "unconfigured" ? "未設定" : "待確認";
  return <span className={`visual-status visual-status-${status}`} title={label} aria-label={label}><i aria-hidden="true" /><span className="sr-only">{label}</span></span>;
}
