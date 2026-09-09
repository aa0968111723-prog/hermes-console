export const QA_CLAIM_STATUSES = [
  "VERIFIED",
  "LIKELY",
  "UNVERIFIED",
  "CONFLICTING",
] as const;

export type QaClaimStatus = (typeof QA_CLAIM_STATUSES)[number];

export const QA_SOURCE_KINDS = [
  "drive",
  "tku_official",
  "instagram",
  "other",
  "none",
] as const;

export type QaSourceKind = (typeof QA_SOURCE_KINDS)[number];

export const EVENT_QA_FIELDS = [
  "name",
  "date",
  "time",
  "location",
  "speaker",
  "fee",
  "registration",
  "organizer",
] as const;

export type EventQaField = (typeof EVENT_QA_FIELDS)[number];

export const EVENT_QA_LABELS: Record<EventQaField, string> = {
  name: "活動名稱",
  date: "日期",
  time: "時間",
  location: "地點",
  speaker: "講師",
  fee: "費用",
  registration: "報名方式",
  organizer: "主辦單位",
};

export type EventClaim = {
  field: EventQaField;
  label: string;
  value: string | null;
  status: QaClaimStatus;
  sourceKind: QaSourceKind;
  inCopy: boolean | null;
  note: string;
};

export type CopyLintIssue = {
  code: string;
  message: string;
  status: QaClaimStatus;
};

export type EventCopyAudit = {
  claims: EventClaim[];
  issues: string[];
  lint: CopyLintIssue[];
  imageText: "UNVERIFIED";
  printSpec: "UNVERIFIED";
  qr: "UNVERIFIED" | "OMITTED" | "CONFLICTING";
  publishBlocked: true;
  retrieved: boolean;
  notice: string;
};
