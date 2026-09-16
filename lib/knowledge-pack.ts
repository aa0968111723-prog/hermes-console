import type { KnowledgeSearchResult } from "./server/zenclub/types";

export const KNOWLEDGE_TOOL = "zenclub_drive_index";

const FIELD_LABEL: Record<string, string> = {
  date: "日期",
  dates: "日期",
  time: "時間",
  place: "地點",
  speaker: "講師",
  registration: "報名",
  name: "名稱",
  meet: "集合",
  stay: "住宿",
};

const STUDENT_FIELDS = new Set(Object.keys(FIELD_LABEL));

const KIND_LABEL: Record<string, string> = {
  activity: "活動",
  camp: "營隊",
  promo: "宣傳",
  person: "人物",
  place: "地點",
  form: "表單",
};

const STUDENT_KINDS = new Set(Object.keys(KIND_LABEL));

export type KnowledgeClaimView = {
  field: string;
  label: string;
  value: string;
  status: "confirmed" | "likely" | "unconfirmed" | "conflict";
};

export type KnowledgeHitView = {
  id: string;
  kindLabel: string;
  title: string;
  semester: string | null;
  claims: KnowledgeClaimView[];
};

export type KnowledgeSearchPack = {
  kind: "club_knowledge";
  live: false;
  snapshot: true;
  instagram: false;
  tamkangLive: false;
  hits: KnowledgeHitView[];
  conflicts: Array<{ label: string; note: string }>;
  missing: string[];
  notice: string;
};

function claimStatus(
  status: string,
): KnowledgeClaimView["status"] {
  if (status === "VERIFIED") return "confirmed";
  if (status === "LIKELY") return "likely";
  if (status === "CONFLICTING") return "conflict";
  return "unconfirmed";
}

function studentClaimValue(value: string | null, status: string) {
  if (value && status !== "UNKNOWN") return value;
  return "未提供";
}

export function toClubKnowledgePack(
  result: KnowledgeSearchResult,
): KnowledgeSearchPack {
  const hits: KnowledgeHitView[] = result.hits
    .filter((hit) => STUDENT_KINDS.has(hit.entity.kind))
    .slice(0, 5)
    .map((hit) => ({
      id: hit.entity.id,
      kindLabel: KIND_LABEL[hit.entity.kind] || "活動",
      title: hit.entity.title,
      semester: hit.entity.semester,
      claims: hit.entity.claims
        .filter((claim) => STUDENT_FIELDS.has(claim.field))
        .slice(0, 6)
        .map((claim) => ({
          field: claim.field,
          label: FIELD_LABEL[claim.field] || claim.field,
          value: studentClaimValue(claim.value, claim.status),
          status: claimStatus(claim.status),
        })),
    }))
    .filter((hit) => hit.claims.length > 0);
  const missing = hits.flatMap((hit) =>
    hit.claims
      .filter((claim) => claim.status === "unconfirmed")
      .map((claim) => hit.title + " · " + claim.label),
  );
  const conflicts = result.conflicts.slice(0, 4).map((conflict) => ({
    label: FIELD_LABEL[conflict.field] || "資料",
    note: conflict.note.replace(/UNKNOWN/g, "未確認"),
  }));
  return {
    kind: "club_knowledge",
    live: false,
    snapshot: true,
    instagram: false,
    tamkangLive: false,
    hits,
    conflicts,
    missing,
    notice: hits.length
      ? "這是社團 Drive 索引快照，不是即時讀檔，也不是 Instagram。沒有連到淡江資料源。缺的日期地點標未確認，不會自己補。"
      : "索引裡沒有對應資料。沒有用 Instagram 或推測補上，也沒有連到淡江資料源。",
  };
}

export function isClubKnowledgePack(
  value: unknown,
): value is KnowledgeSearchPack {
  if (!value || typeof value !== "object") return false;
  const pack = value as Record<string, unknown>;
  return (
    pack.kind === "club_knowledge" &&
    pack.live === false &&
    pack.snapshot === true &&
    pack.instagram === false &&
    pack.tamkangLive === false &&
    Array.isArray(pack.hits) &&
    Array.isArray(pack.conflicts) &&
    Array.isArray(pack.missing) &&
    typeof pack.notice === "string"
  );
}
