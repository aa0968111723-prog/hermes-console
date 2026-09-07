export const CAPABILITY_STATUSES = [
  "unknown",
  "configured",
  "reachable",
  "authenticated",
  "verified",
  "partial",
  "failed",
  "unsupported",
] as const;

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const EVIDENCE_KINDS = [
  "LOCAL_UNIT",
  "LOCAL_CONTRACT",
  "LOCAL_BROWSER",
  "LIVE_EXTERNAL",
  "UNVERIFIED",
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const TRUTH_CLASSES = [
  "FACT",
  "USER_PROVIDED",
  "SOURCE_VERIFIED",
  "INFERENCE",
  "SIMULATION",
  "UNKNOWN",
] as const;

export type TruthClass = (typeof TRUTH_CLASSES)[number];

export type IntegrationId =
  | "hermes"
  | "zeabur"
  | "tamkang"
  | "canva"
  | "memory"
  | "mcp"
  | "research";

export interface CertificationEvidence {
  kind: EvidenceKind;
  at: string;
  summary: string;
  latencyMs: number | null;
  httpStatus: number | null;
  errorCode: string | null;
}

export interface CapabilityRecord {
  id: string;
  integration: IntegrationId;
  name: string;
  status: CapabilityStatus;
  lastCheckedAt: string | null;
  lastVerifiedAt: string | null;
  latencyMs: number | null;
  evidence: CertificationEvidence | null;
  message: string;
  required: boolean;
}

export interface IntegrationCertification {
  id: IntegrationId;
  name: string;
  overall: CapabilityStatus;
  capabilities: CapabilityRecord[];
  lastCheckedAt: string | null;
  notice: string;
}

export interface CertificationReport {
  checkedAt: string;
  evidencePolicy: {
    loopbackIs: "LOCAL_CONTRACT";
    liveHttpsIs: "LIVE_EXTERNAL";
    neverPromoteMockToLive: true;
  };
  integrations: IntegrationCertification[];
}
