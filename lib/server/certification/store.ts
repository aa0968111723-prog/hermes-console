import { get, put } from "../store";
import type { CertificationReport } from "./types";
import { emptyIntegration, allIntegrationIds } from "./registry";
import { nowIso } from "./evidence";

const KIND = "certification_report";
const ID = "current";

export function emptyReport(): CertificationReport {
  return {
    checkedAt: nowIso(),
    evidencePolicy: {
      loopbackIs: "LOCAL_CONTRACT",
      liveHttpsIs: "LIVE_EXTERNAL",
      neverPromoteMockToLive: true,
    },
    integrations: allIntegrationIds().map(emptyIntegration),
  };
}

export function loadReport(owner: string): CertificationReport {
  return get<CertificationReport & { id: string }>(KIND, owner, ID) || emptyReport();
}

export function saveReport(owner: string, report: CertificationReport) {
  return put(KIND, owner, { ...report, id: ID });
}

export function publicReport(report: CertificationReport): CertificationReport {
  return {
    checkedAt: report.checkedAt,
    evidencePolicy: report.evidencePolicy,
    integrations: report.integrations.map((item) => ({
      ...item,
      capabilities: item.capabilities.map((cap) => ({
        ...cap,
        evidence: cap.evidence
          ? {
              kind: cap.evidence.kind,
              at: cap.evidence.at,
              summary: cap.evidence.summary,
              latencyMs: cap.evidence.latencyMs,
              httpStatus: cap.evidence.httpStatus,
              errorCode: cap.evidence.errorCode,
            }
          : null,
      })),
    })),
  };
}
