import type { Fact } from "../../creative";
import {
  copyMentionsDate,
  dateWeekdayConflicts,
  parseCalendarDate,
} from "./calendar";
import { lintCopyText } from "./copy-lint";
import { claimStatusCeiling, strongestSourceKind } from "./sources";
import {
  EVENT_QA_FIELDS,
  EVENT_QA_LABELS,
  type EventClaim,
  type EventCopyAudit,
  type EventQaField,
  type QaClaimStatus,
  type QaSourceKind,
} from "./types";

const SPEAKER_RE = /講師[:：]\s*([^\n，。；;]{1,40})/g;
const URL_RE = /https:\/\/[^\s)）\]】>]+/g;

type PublicFact = Pick<Fact, "field" | "value" | "state" | "visibility" | "sources">;

function publicFacts(facts: PublicFact[], field: string) {
  return facts.filter(
    (item) =>
      item.field === field &&
      item.visibility === "public" &&
      item.state !== "rejected",
  );
}

function uniqueValues(items: PublicFact[]) {
  return [...new Set(items.map((item) => item.value.trim()).filter(Boolean))];
}

function extractSpeaker(text: string) {
  const names: string[] = [];
  for (const match of text.matchAll(SPEAKER_RE)) {
    const name = match[1]?.trim();
    if (name) names.push(name);
  }
  return [...new Set(names)];
}

function classifyField(
  field: EventQaField,
  facts: PublicFact[],
  text: string,
): EventClaim {
  const label = EVENT_QA_LABELS[field];
  const rows =
    field === "speaker"
      ? publicFacts(facts, "speaker")
      : publicFacts(facts, field);
  const values = uniqueValues(rows);
  const spoken = field === "speaker" ? extractSpeaker(text) : [];
  const combined = [...new Set([...values, ...spoken])];

  if (combined.length > 1) {
    return {
      field,
      label,
      value: combined.join(" ／ "),
      status: "CONFLICTING",
      sourceKind: strongestSourceKind(rows.flatMap((row) => row.sources.map((s) => s.url))),
      inCopy: combined.some((value) => text.includes(value)),
      note: "同一欄位有多個值，不得擇一假裝已確認。",
    };
  }

  if (!combined.length) {
    return {
      field,
      label,
      value: null,
      status: "UNVERIFIED",
      sourceKind: "none",
      inCopy: field === "speaker" ? /講師/.test(text) : null,
      note: "沒有可核對來源，標 UNVERIFIED，不得補造。",
    };
  }

  const value = combined[0]!;
  const matching = rows.filter((row) => row.value.trim() === value);
  const sourceKind: QaSourceKind = strongestSourceKind(
    matching.flatMap((row) => row.sources.map((s) => s.url)),
  );
  const confirmed = matching.some((row) => row.state === "confirmed");
  const userProvided = matching.some((row) => row.state === "user_provided");
  const ceiling = claimStatusCeiling(sourceKind);
  let status: QaClaimStatus = "UNVERIFIED";
  let note = "尚未確認，也尚未重讀 Drive／官方原檔。";

  if (confirmed && sourceKind !== "none") {
    // Owner confirmation + URL is not a live retrieve. Ceiling VERIFIED is reserved
    // for fetched Drive / TKU pages; this engine does not fetch, so stay at LIKELY.
    status = "LIKELY";
    note =
      ceiling === "VERIFIED"
        ? "已附 Drive／官方網址且使用者確認，但本核對未重讀原檔，最高 LIKELY。"
        : sourceKind === "instagram"
          ? "來源是 Instagram。IG 只作對外呈現，不能當內部事實 VERIFIED。"
          : "使用者已確認並附來源，本核對未重讀原檔，標 LIKELY。";
  } else if (confirmed) {
    status = "LIKELY";
    note = "僅有工作區確認、沒有 Drive／官方來源，不是 VERIFIED。";
  } else if (userProvided && sourceKind !== "none") {
    status = "UNVERIFIED";
    note = "使用者提供並附網址，但尚未確認、也未重讀原檔。";
  } else if (spoken.length && !matching.length) {
    status = "UNVERIFIED";
    note = "文案出現講師姓名，活動資料沒有對應欄位或來源。";
  }

  let inCopy: boolean | null = text.includes(value);
  if (field === "date") {
    const parsed = parseCalendarDate(value);
    inCopy = copyMentionsDate(text, value, parsed?.year ?? null);
  }

  return { field, label, value, status, sourceKind, inCopy, note };
}

export function auditEventCopy(input: {
  title?: string;
  facts: PublicFact[];
  text: string;
  format?: string;
}): EventCopyAudit {
  const text = [input.title || "", input.text].filter(Boolean).join("\n");
  const claims = EVENT_QA_FIELDS.map((field) =>
    classifyField(field, input.facts, text),
  );
  const lint = lintCopyText(text);
  const issues: string[] = [];

  for (const claim of claims) {
    if (claim.status === "CONFLICTING") {
      issues.push(claim.label + " CONFLICTING：" + (claim.value || "") + "。");
    }
  }

  const dateFacts = publicFacts(input.facts, "date").map((item) => item.value);
  for (const conflict of dateWeekdayConflicts(text, dateFacts)) {
    issues.push(
      "日期與星期不符：" +
        conflict.raw +
        " 寫成 " +
        conflict.claimed +
        "，Asia/Taipei 實際為 " +
        conflict.actual +
        "。",
    );
  }

  const dateClaim = claims.find((item) => item.field === "date");
  if (
    dateClaim?.status === "LIKELY" &&
    dateClaim.value &&
    dateClaim.inCopy === false
  ) {
    issues.push("文案未包含已記錄的日期「" + dateClaim.value + "」，請人工核對。");
  }

  const registration = claims.find((item) => item.field === "registration");
  const urls = [...text.matchAll(URL_RE)].map((item) => item[0].replace(/[.,，。]+$/, ""));
  if (urls.length) {
    const allowed = publicFacts(input.facts, "registration").flatMap((row) => [
      row.value,
      ...row.sources.map((s) => s.url),
    ]);
    for (const url of urls) {
      const known = allowed.some((item) => item.includes(url) || url.includes(item));
      if (!known) {
        issues.push("文案含未確認連結，可能是補造報名／QR：" + url);
      }
    }
  }
  if (/QR\s*Code|QR碼|qrcode|二維碼/i.test(text) && registration?.status !== "LIKELY") {
    issues.push("提到 QR 但報名方式不是 LIKELY／VERIFIED，不要放未確認 QR。");
  }

  for (const item of lint) {
    if (item.code === "qr_mentioned") continue;
    issues.push(item.message);
  }

  let qr: EventCopyAudit["qr"] = "OMITTED";
  if (/QR\s*Code|QR碼|qrcode|二維碼/i.test(text)) {
    qr = registration?.status === "CONFLICTING" ? "CONFLICTING" : "UNVERIFIED";
  }

  const print =
    input.format === "post" || input.format === "story" || input.format === "reel"
      ? "未量測輸出像素；IG 尺寸與圖片錯字標 UNVERIFIED。"
      : "印刷出血／安全區未量測實體檔，標 UNVERIFIED。";

  return {
    claims,
    issues: [...new Set(issues)],
    lint,
    imageText: "UNVERIFIED",
    printSpec: "UNVERIFIED",
    qr,
    publishBlocked: true,
    retrieved: false,
    notice:
      "自動核對不是發佈許可。未重讀 Drive 原檔、未做圖片 OCR、未量測出血。" + print,
  };
}
