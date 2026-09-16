import { interpretGoal } from "./orchestrator/goal";
import { searchZenclubKnowledge, needsZenclubKnowledge } from "./zenclub";
import {
  knowledgeVisualPack,
  persistKnowledgeVisualPack,
} from "./zenclub/visual-pack";
import type { KnowledgeClaim, KnowledgeEntity } from "./zenclub/types";

const HONESTY =
  "Hermes Agent 尚未連線。工作區 Drive 快照，不是即時讀檔，也不是 Instagram。";

const FIELD_LABEL: Record<string, string> = {
  date: "日期",
  dates: "日期",
  time: "時間",
  place: "地點",
  location: "地點",
  registration: "報名",
  speaker: "講者",
  title: "主題",
};

const STUDENT_FIELDS = new Set(Object.keys(FIELD_LABEL));

function claimLine(claim: KnowledgeClaim) {
  const label = FIELD_LABEL[claim.field] || claim.field;
  if (claim.status === "UNKNOWN" || claim.value == null) return `- ${label}：UNKNOWN`;
  return `- ${label}：${claim.value}`;
}

function formatEntity(entity: KnowledgeEntity) {
  const heading = [entity.title, entity.semester].filter(Boolean).join(" · ");
  const claims = entity.claims
    .filter((claim) => STUDENT_FIELDS.has(claim.field))
    .slice(0, 8)
    .map(claimLine);
  if (!claims.length) return "";
  return ["### " + heading, ...claims].join("\n");
}

export function localWorkspaceReply(
  input: string,
  ctx?: { owner: string; projectId: string },
): string | null {
  const text = input.trim();
  if (!needsZenclubKnowledge(text)) return null;
  const knowledge = searchZenclubKnowledge(text);
  const goal = interpretGoal(text);
  const top = knowledge.hits[0]?.entity;
  if (top && (goal.requiresInspiration || goal.requiresDesign)) {
    const pack =
      ctx?.owner
        ? persistKnowledgeVisualPack(
            ctx.owner,
            ctx.projectId || "personal",
            text,
            top,
            HONESTY,
          )
        : knowledgeVisualPack(top, HONESTY);
    return JSON.stringify(pack);
  }
  const lines = [HONESTY, knowledge.notice];
  const card = top ? formatEntity(top) : "";
  if (!card) {
    lines.push("索引沒有命中。缺資料標 UNKNOWN，不得自行補日期或地點。");
  } else {
    lines.push(card);
  }
  return lines.join("\n\n");
}
