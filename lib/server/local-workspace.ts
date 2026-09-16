import { interpretGoal } from "./orchestrator/goal";
import { searchZenclubKnowledge, needsZenclubKnowledge } from "./zenclub";
import { searchInspiration } from "./inspiration/engine";
import type { KnowledgeClaim, KnowledgeEntity } from "./zenclub/types";

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
  projectId = "personal",
): string | null {
  const text = input.trim();
  if (!needsZenclubKnowledge(text)) return null;
  const knowledge = searchZenclubKnowledge(text);
  const goal = interpretGoal(text);
  const lines = [
    "Hermes Agent 尚未連線，沒有上網搜尋，也沒有使用 GALLEY 或 Canva。",
    knowledge.notice,
  ];
  const cards = knowledge.hits
    .map((hit) => formatEntity(hit.entity))
    .filter(Boolean)
    .slice(0, 4);
  if (!cards.length) {
    lines.push("索引沒有命中。缺資料標 UNKNOWN，不得自行補日期或地點。");
  } else {
    lines.push(...cards);
  }
  const unknownPlaces = knowledge.unknowns.filter((item) =>
    /place|location|地點/.test(item),
  );
  if (unknownPlaces.length) {
    lines.push(["### UNKNOWN", ...unknownPlaces.slice(0, 6).map((item) => "- " + item)].join("\n"));
  } else if (!knowledge.hits.length && knowledge.unknowns.length) {
    lines.push(
      ["### UNKNOWN", ...knowledge.unknowns.slice(0, 6).map((item) => "- " + item)].join(
        "\n",
      ),
    );
  }
  if (knowledge.conflicts.length) {
    lines.push(
      [
        "### 不要混用舊標題",
        ...knowledge.conflicts
          .slice(0, 4)
          .map((item) => `- ${item.note || item.values.join("／")}`),
      ].join("\n"),
    );
  }
  if (goal.requiresInspiration) {
    let notice =
      "沒有搜尋整個 Instagram 或 Pinterest。只使用已保存的參考與可開啟的網址。";
    const saved: string[] = [];
    try {
      const inspiration = searchInspiration({
        prompt: text,
        projectId,
      });
      notice = inspiration.notice;
      for (const item of inspiration.items.slice(0, 6)) {
        saved.push(
          `- ${item.account || item.platform}：${(item.captionExcerpt || item.sourceUrl).slice(0, 80)}`,
        );
      }
    } catch {
      saved.length = 0;
    }
    lines.push(
      [
        "### 靈感",
        notice,
        saved.length
          ? saved.join("\n")
          : "目前沒有已保存的參考圖。連上 Hermes 後才能找參考與出圖。",
      ].join("\n"),
    );
  }
  if (goal.requiresDesign || goal.requiresAudienceEvaluation) {
    lines.push(
      "出圖、Canva 與完整受眾模擬需要 Hermes 連線後才能繼續。受眾評估若出現，只是模擬，不是民調。",
    );
  }
  return lines.join("\n\n");
}
