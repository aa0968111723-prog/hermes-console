import type { CapabilityStatus, EvidenceKind } from "./types";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function nowIso() {
  return new Date().toISOString();
}

export function evidenceKindForUrl(raw?: string | null): EvidenceKind {
  if (!raw) return "UNVERIFIED";
  try {
    const url = new URL(raw);
    if (LOOPBACK.has(url.hostname)) return "LOCAL_CONTRACT";
    if (url.protocol === "https:") return "LIVE_EXTERNAL";
    return "UNVERIFIED";
  } catch {
    return "UNVERIFIED";
  }
}

export function isLiveEvidence(kind: EvidenceKind) {
  return kind === "LIVE_EXTERNAL";
}

/** A models-list or initialize success must never become a whole-integration verified. */
export function overallFromCapabilities(
  statuses: CapabilityStatus[],
  required: CapabilityStatus[],
): CapabilityStatus {
  if (statuses.every((status) => status === "unknown")) return "unknown";
  if (required.some((status) => status === "failed")) return "failed";
  if (required.every((status) => status === "unsupported")) return "unsupported";
  const requiredDone = required.every(
    (status) => status === "verified" || status === "unsupported",
  );
  const anyVerified = statuses.includes("verified");
  const anyFailed = statuses.includes("failed");
  const anyConfigured = statuses.some(
    (status) => status !== "unknown" && status !== "unsupported",
  );
  if (requiredDone && anyVerified && !anyFailed) {
    const optionalPending = statuses.some(
      (status) =>
        status === "unknown" ||
        status === "configured" ||
        status === "reachable" ||
        status === "authenticated" ||
        status === "partial",
    );
    return optionalPending ? "partial" : "verified";
  }
  if (anyFailed) return "partial";
  if (anyConfigured) return "partial";
  return "unknown";
}

export function statusLabel(status: CapabilityStatus) {
  switch (status) {
    case "unknown":
      return "未驗證";
    case "configured":
      return "已設定";
    case "reachable":
      return "可連線";
    case "authenticated":
      return "已通過認證";
    case "verified":
      return "已驗證";
    case "partial":
      return "部分可用";
    case "failed":
      return "失敗";
    case "unsupported":
      return "不支援";
  }
}
